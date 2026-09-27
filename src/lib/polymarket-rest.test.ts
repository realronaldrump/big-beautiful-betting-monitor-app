import { createPrivateKey, createPublicKey, verify } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import {
  ApiPacer,
  authenticationHeaders,
  PolymarketRestClient,
} from "./polymarket-rest";
import { AutomationStore } from "@/automation/store";
import { PolymarketTradingAdapter } from "@/automation/polymarket-adapter";
import { AutomationEngine, type TrackedMarket } from "@/automation/engine";
const secret = Buffer.alloc(32, 7).toString("base64");
afterEach(() => vi.useRealTimers());
it("signs the documented Ed25519 authentication message", () => {
  const headers = authenticationHeaders(
    "test-key",
    secret,
    "POST",
    "/v1/orders",
  );
  const key = createPublicKey(
    createPrivateKey({
      key: Buffer.concat([
        Buffer.from("302e020100300506032b657004220420", "hex"),
        Buffer.from(secret, "base64"),
      ]),
      format: "der",
      type: "pkcs8",
    }),
  );
  expect(
    verify(
      null,
      Buffer.from(`${headers["X-PM-Timestamp"]}POST/v1/orders`),
      key,
      Buffer.from(headers["X-PM-Signature"], "base64"),
    ),
  ).toBe(true);
});
it("shares pacing slots across independent clients", async () => {
  vi.useFakeTimers();
  const store = new AutomationStore(":memory:");
  const starts: number[] = [];
  const fetchFn = vi.fn(async () => {
    starts.push(Date.now());
    return new Response("{}");
  });
  const a = new PolymarketRestClient(
    new ApiPacer(125, store),
    { keyId: "test", secret },
    fetchFn,
  );
  const b = new PolymarketRestClient(
    new ApiPacer(125, store),
    { keyId: "test", secret },
    fetchFn,
  );
  const requests = Promise.all(
    Array.from({ length: 24 }, (_, i) =>
      (i % 2 ? a : b).request("/v1/account/balances"),
    ),
  );
  await vi.runAllTimersAsync();
  await requests;
  expect(starts).toHaveLength(24);
  expect(
    starts.every((time, i) => i === 0 || time - starts[i - 1] >= 125),
  ).toBe(true);
  store.close();
});
it("blocks a real transport dispatch when Off was saved while queued", async () => {
  const store = new AutomationStore(":memory:");
  store.updateConfig({
    enabled: true,
    balanceFloor: 100,
    triggerPrice: 0.95,
    executionCap: 0.96,
  });
  const pacer = new ApiPacer(0);
  let release!: () => void;
  const blocker = new Promise<void>((r) => (release = r));
  const calls: string[] = [];
  const fetchFn = vi.fn(async (url: RequestInfo | URL) => {
    const path = new URL(String(url)).pathname;
    calls.push(path);
    if (path === "/v1/order/preview") void pacer.run(() => blocker);
    return new Response(
      JSON.stringify(
        path === "/v1/orders" ? { id: "should-not-send" } : { order: {} },
      ),
    );
  });
  const adapter = new PolymarketTradingAdapter(
    new PolymarketRestClient(pacer, { keyId: "test", secret }, fetchFn),
  );
  let reached!: () => void;
  const reachedQueue = new Promise<void>((r) => (reached = r));
  const create = adapter.createOrder.bind(adapter);
  vi.spyOn(adapter, "createOrder").mockImplementation((order, check) => {
    reached();
    return create(order, check);
  });
  const market: TrackedMarket = {
    marketSlug: "m",
    eventSlug: "e",
    eventTitle: "E",
    marketTitle: "M",
    longOutcome: "Yes",
    shortOutcome: "No",
    minimumTradeQty: 0.01,
    priceTickSize: 0.01,
    isLive: true,
    isOpen: true,
  };
  const pending = new AutomationEngine(store, adapter).processQuote({
    market,
    quote: { bestAsk: 0.95 },
    balances: { currentBalance: 250, buyingPower: 250 },
  });
  await reachedQueue;
  store.setEnabled(false);
  release();
  expect(await pending).toBe("ignored");
  expect(calls).toEqual(["/v1/order/preview"]);
  expect(store.getAttempt("m")).toMatchObject({
    status: "retryable",
    attempts: 0,
  });
  store.close();
});
