import { createPrivateKey, sign } from "node:crypto";
import { getAutomationStore, type AutomationStore } from "@/automation/store";

export class RequestCancelledError extends Error {}
export class PolymarketRequestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export function hasCredentials() {
  return Boolean(
    process.env.POLYMARKET_KEY_ID && process.env.POLYMARKET_SECRET_KEY,
  );
}

/** One rate budget shared by the web process and worker through SQLite. */
export class ApiPacer {
  private tail: Promise<unknown> = Promise.resolve();
  private lastStartedAt = -Infinity;
  constructor(
    private readonly minimumSpacingMs = 125,
    private readonly store?: AutomationStore,
  ) {}
  run<T>(request: () => Promise<T>, check?: () => void): Promise<T> {
    const next = this.tail.then(async () => {
      for (;;) {
        check?.();
        const wait = this.store
          ? this.store.claimApiSlot(Date.now(), this.minimumSpacingMs)
          : Math.max(
              0,
              this.minimumSpacingMs - (Date.now() - this.lastStartedAt),
            );
        if (wait <= 0) break;
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(wait, 100)),
        );
      }
      check?.();
      this.lastStartedAt = Date.now();
      return request();
    });
    this.tail = next.catch(() => undefined);
    return next;
  }
}

export interface RestRequest {
  method?: "GET" | "POST";
  authenticated?: boolean;
  query?: Record<string, unknown>;
  body?: unknown;
  beforeSend?: () => void;
  signal?: AbortSignal;
}

/** Synchronous signing lets the dispatch guard run immediately before fetch. */
export function authenticationHeaders(
  keyId: string,
  secret: string,
  method: string,
  pathname: string,
) {
  const seed = Buffer.from(secret, "base64");
  if (seed.length !== 32 && seed.length !== 64)
    throw new Error("Invalid Polymarket API key format.");
  const key = createPrivateKey({
    key: Buffer.concat([
      Buffer.from("302e020100300506032b657004220420", "hex"),
      seed.subarray(0, 32),
    ]),
    format: "der",
    type: "pkcs8",
  });
  const timestamp = String(Date.now());
  return {
    "X-PM-Access-Key": keyId,
    "X-PM-Timestamp": timestamp,
    "X-PM-Signature": sign(
      null,
      Buffer.from(`${timestamp}${method}${pathname}`),
      key,
    ).toString("base64"),
  };
}

export class PolymarketRestClient {
  constructor(
    private readonly pacer = new ApiPacer(125, getAutomationStore()),
    private readonly credentials = {
      keyId: process.env.POLYMARKET_KEY_ID || "",
      secret: process.env.POLYMARKET_SECRET_KEY || "",
    },
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  request<T>(pathname: string, options: RestRequest = {}): Promise<T> {
    const check = () => {
      options.signal?.throwIfAborted();
      options.beforeSend?.();
    };
    return this.pacer.run(
      async () => {
        const method = options.method || "GET";
        const authenticated = options.authenticated !== false;
        const url = new URL(
          pathname,
          authenticated
            ? "https://api.polymarket.us"
            : "https://gateway.polymarket.us",
        );
        for (const [key, value] of Object.entries(options.query || {})) {
          if (value === undefined || value === null) continue;
          for (const item of Array.isArray(value) ? value : [value])
            url.searchParams.append(key, String(item));
        }
        if (
          authenticated &&
          (!this.credentials.keyId || !this.credentials.secret)
        )
          throw new Error("Polymarket US credentials are not configured.");
        const headers = {
          "Content-Type": "application/json",
          ...(authenticated
            ? authenticationHeaders(
                this.credentials.keyId,
                this.credentials.secret,
                method,
                url.pathname,
              )
            : {}),
        };
        const signal = AbortSignal.any([
          AbortSignal.timeout(20_000),
          ...(options.signal ? [options.signal] : []),
        ]);
        // Nothing asynchronous may be inserted between this check and fetch.
        check();
        const response = await this.fetchFn(url.toString(), {
          method,
          headers,
          body:
            options.body === undefined
              ? undefined
              : JSON.stringify(options.body),
          signal,
          cache: "no-store",
        });
        const text = await response.text();
        if (!response.ok) {
          let message = response.statusText;
          try {
            const error = JSON.parse(text);
            message = error.message || error.error || message;
          } catch {
            /* Do not expose proxy HTML. */
          }
          throw new PolymarketRequestError(
            response.status,
            String(message).slice(0, 220),
          );
        }
        return (text ? JSON.parse(text) : {}) as T;
      },
      () => options.signal?.throwIfAborted(),
    );
  }
}
