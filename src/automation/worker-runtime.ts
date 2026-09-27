import type {
  MarketDataLite,
  MarketsWebSocket,
  PolymarketUS,
  PrivateWebSocket,
} from "polymarket-us";
import {
  AutomationEngine,
  type MarketQuote,
  type TrackedMarket,
  type TradingAdapter,
  type QuoteState,
} from "@/automation/engine";
import {
  extractLiveMarkets,
  type RawLiveEventsResponse,
} from "@/automation/live-markets";
import {
  createPolymarketTradingClient,
  PolymarketTradingAdapter,
} from "@/automation/polymarket-adapter";
import {
  hasCredentials,
  PolymarketRestClient,
  RequestCancelledError,
} from "@/lib/polymarket-rest";
import { getAutomationStore, type AutomationStore } from "@/automation/store";
import {
  type ParsedOrderExecution,
  extractAccountBalances,
  extractOrderExecution,
} from "@/automation/websocket-parsers";

const DISCOVERY_INTERVAL_MS = 15_000;
const BALANCE_INTERVAL_MS = 60_000;
const PRIVATE_RECONNECT_INTERVAL_MS = 30_000;
const LOOP_INTERVAL_MS = 1_000;
const ERROR_RETRY_MS = 15_000;
const INITIAL_RATE_LIMIT_RETRY_MS = 1_000;
const MAX_RATE_LIMIT_RETRY_MS = 30_000;
const RATE_LIMIT_RECOVERY_MS = 60_000;
const MAX_MARKETS_PER_SUBSCRIPTION = 100;
const MAX_LIVE_EVENT_PAGES = 10;

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

export async function waitForRetryOrConfigChange(options: {
  delayMs: number;
  initialConfigUpdatedAt: string;
  readConfigUpdatedAt: () => string;
  isStopping: () => boolean;
  sleepFn?: (milliseconds: number) => Promise<void>;
}) {
  const sleepFn = options.sleepFn || sleep;
  let remainingMs = options.delayMs;

  while (remainingMs > 0) {
    if (options.isStopping()) return "stopped" as const;
    const intervalMs = Math.min(250, remainingMs);
    await sleepFn(intervalMs);
    remainingMs -= intervalMs;
    if (options.isStopping()) return "stopped" as const;
    if (options.readConfigUpdatedAt() !== options.initialConfigUpdatedAt) {
      return "config-changed" as const;
    }
  }

  return "elapsed" as const;
}

export class MarketWorkGate {
  private readonly inFlight = new Set<string>();

  begin(marketSlug: string) {
    if (this.inFlight.has(marketSlug)) return false;
    this.inFlight.add(marketSlug);
    return true;
  }

  end(marketSlug: string) {
    this.inFlight.delete(marketSlug);
  }
}

function amountValue(value: { value: string } | undefined) {
  if (!value) return undefined;
  const parsed = Number(value.value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function chunk<T>(items: T[], size: number) {
  const groups: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    groups.push(items.slice(index, index + size));
  }
  return groups;
}

function sameSlugs(left: Map<string, TrackedMarket>, right: TrackedMarket[]) {
  if (left.size !== right.length) return false;
  return right.every((market) => left.has(market.marketSlug));
}

function errorStatus(error: unknown) {
  return typeof error === "object" && error !== null && "status" in error
    ? Number((error as { status?: unknown }).status)
    : 0;
}

export function isRateLimitError(error: unknown) {
  if (errorStatus(error) === 429) return true;
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("error 1015") || message.includes("being rate limited")
  );
}

export function retryPlan(error: unknown, currentRateLimitDelayMs: number) {
  if (!isRateLimitError(error)) {
    return {
      delayMs: ERROR_RETRY_MS,
      nextRateLimitDelayMs: currentRateLimitDelayMs,
    };
  }
  return {
    delayMs: currentRateLimitDelayMs,
    nextRateLimitDelayMs: Math.min(
      currentRateLimitDelayMs * 2,
      MAX_RATE_LIMIT_RETRY_MS,
    ),
  };
}

export function hasSustainedRateLimitRecovery(
  lastRateLimitAt: number | null,
  now: number,
) {
  return (
    lastRateLimitAt !== null && now - lastRateLimitAt >= RATE_LIMIT_RECOVERY_MS
  );
}

function publicWorkerError(error: unknown) {
  if (error instanceof Error) {
    const message = error.message.replace(/\s+/g, " ").trim();
    if (isRateLimitError(error)) {
      return "Polymarket briefly throttled a request. The worker is reducing request pressure and retrying shortly.";
    }
    return message.slice(0, 220);
  }
  return "The automatic betting worker encountered an unknown error.";
}

export interface WorkerDependencies {
  store?: AutomationStore;
  client?: PolymarketUS;
  adapter?: TradingAdapter;
  rest?: PolymarketRestClient;
  credentialsAvailable?: () => boolean;
}

export class AutomationWorker {
  private readonly store: AutomationStore;
  private readonly client: PolymarketUS;
  private readonly adapter: TradingAdapter;
  private readonly rest: PolymarketRestClient;
  private readonly engine: AutomationEngine;
  private readonly credentialsAvailable: () => boolean;
  private trackedMarkets = new Map<string, TrackedMarket>();
  private latestQuotes = new Map<
    string,
    { quote: MarketQuote; at: number; sequence: number }
  >();
  private quoteSequence = 0;
  private marketSocket: MarketsWebSocket | null = null;
  private privateSocket: PrivateWebSocket | null = null;
  private pendingSubscriptions = new Set<string>();
  private subscriptionByMarket = new Map<string, string>();
  private subscriptionsStartedAt = 0;
  private privateBalanceReady = false;
  private privateOrdersReady = false;
  private lastDiscoveryAt = 0;
  private lastBalanceAt = 0;
  private balanceSequence = 0;
  private lastPrivateAttemptAt = 0;
  private lastReconcileAt = 0;
  private lastConfigRevision = -1;
  private rateLimitRetryMs = INITIAL_RATE_LIMIT_RETRY_MS;
  private lastRateLimitAt: number | null = null;
  private pendingWorkerError: unknown | null = null;
  private readonly marketWorkGate = new MarketWorkGate();
  private quoteQueueGeneration = 0;
  private shuttingDown = false;
  private qualifiedQuoteQueue: Promise<void> = Promise.resolve();

  constructor(dependencies: WorkerDependencies = {}) {
    this.store = dependencies.store || getAutomationStore();
    this.client = dependencies.client || createPolymarketTradingClient();
    this.rest = dependencies.rest || new PolymarketRestClient();
    this.adapter =
      dependencies.adapter || new PolymarketTradingAdapter(this.rest);
    this.engine = new AutomationEngine(this.store, this.adapter);
    this.credentialsAvailable =
      dependencies.credentialsAvailable || hasCredentials;
  }

  async run() {
    this.store.updateRuntime({
      state: "off",
      heartbeatAt: new Date().toISOString(),
      lastError: null,
      stopReason: null,
    });
    // Recover preview-only reservations without risking a duplicate exchange order.
    await this.engine.reconcileInterruptedAttempts();
    while (!this.shuttingDown) {
      const config = this.store.getConfig();
      const heartbeatAt = new Date().toISOString();
      if (config.revision !== this.lastConfigRevision) {
        this.quoteQueueGeneration += 1;
        this.lastConfigRevision = config.revision;
        for (const slug of this.latestQuotes.keys()) this.scheduleMarket(slug);
      }
      if (!config.enabled || !this.credentialsAvailable()) {
        this.closeSockets();
        this.pendingWorkerError = null;
        this.rateLimitRetryMs = INITIAL_RATE_LIMIT_RETRY_MS;
        this.lastRateLimitAt = null;
        this.store.updateRuntime({
          state: config.enabled ? "error" : "off",
          heartbeatAt,
          lastError: config.enabled
            ? "Polymarket API credentials are not configured."
            : null,
          stopReason: null,
          liveEvents: 0,
          monitoredMarkets: 0,
          currentBalance: null,
          buyingPower: null,
        });
        await sleep(LOOP_INTERVAL_MS);
        continue;
      }
      try {
        this.throwPendingError();
        await this.tryPrivateSocket();
        if (Date.now() - this.lastBalanceAt >= BALANCE_INTERVAL_MS)
          await this.refreshBalances();
        if (Date.now() - this.lastReconcileAt >= BALANCE_INTERVAL_MS) {
          this.lastReconcileAt = Date.now();
          await this.engine.reconcileInterruptedAttempts();
        }
        const runtime = this.store.getRuntime();
        if (
          runtime.currentBalance === null ||
          Math.min(runtime.currentBalance, runtime.buyingPower ?? 0) - 1 <
            config.balanceFloor
        ) {
          this.closeMarketSocket();
          this.store.updateRuntime({
            state: "stopped",
            heartbeatAt,
            lastError: null,
            stopReason: `Cash reserve protected — ${config.balanceFloor.toFixed(2)} dollars must remain after an order and its fees.`,
            liveEvents: 0,
            monitoredMarkets: 0,
          });
          await sleep(LOOP_INTERVAL_MS);
          continue;
        }
        // An empty discovery result is still a successful discovery, with its own cadence.
        if (Date.now() - this.lastDiscoveryAt >= DISCOVERY_INTERVAL_MS)
          await this.refreshLiveMarkets();
        this.throwPendingError();
        if (
          this.subscriptionsStartedAt &&
          this.pendingSubscriptions.size &&
          Date.now() - this.subscriptionsStartedAt > 10_000
        ) {
          throw new Error(
            "Market subscriptions did not return data; reconnecting.",
          );
        }
        if (
          this.privateSocket?.isConnected &&
          (!this.privateBalanceReady || !this.privateOrdersReady) &&
          Date.now() - this.lastPrivateAttemptAt > 10_000
        ) {
          throw new Error(
            "Account subscriptions did not return data; reconnecting.",
          );
        }
        const ready =
          this.privateSocket?.isConnected &&
          this.privateBalanceReady &&
          this.privateOrdersReady &&
          this.pendingSubscriptions.size === 0;
        this.store.updateRuntime({
          state: ready ? "watching" : "starting",
          heartbeatAt: new Date().toISOString(),
          ...(ready ? { lastError: null } : {}),
          stopReason: ready
            ? null
            : "Waiting for live prices and account subscriptions.",
          monitoredMarkets: this.trackedMarkets.size,
        });
        if (hasSustainedRateLimitRecovery(this.lastRateLimitAt, Date.now())) {
          this.rateLimitRetryMs = INITIAL_RATE_LIMIT_RETRY_MS;
          this.lastRateLimitAt = null;
        }
      } catch (error) {
        if (this.shuttingDown) break;
        if (error instanceof RequestCancelledError) continue;
        if (isRateLimitError(error)) this.lastRateLimitAt = Date.now();
        const retry = retryPlan(error, this.rateLimitRetryMs);
        this.rateLimitRetryMs = retry.nextRateLimitDelayMs;
        this.closeSockets();
        this.pendingWorkerError = null;
        this.store.updateRuntime({
          state: "error",
          heartbeatAt: new Date().toISOString(),
          lastError: publicWorkerError(error),
          stopReason: "The worker will retry automatically.",
        });
        await waitForRetryOrConfigChange({
          delayMs: retry.delayMs,
          initialConfigUpdatedAt: String(config.revision),
          readConfigUpdatedAt: () => String(this.store.getConfig().revision),
          isStopping: () => this.shuttingDown,
        });
        continue;
      }
      await sleep(LOOP_INTERVAL_MS);
    }
    this.closeSockets();
    // Keep the process alive long enough to persist a response to an already-dispatched order.
    await this.qualifiedQuoteQueue;
    this.store.updateRuntime({
      state: "off",
      heartbeatAt: new Date().toISOString(),
      stopReason: "Automation worker stopped.",
    });
  }

  stop() {
    this.shuttingDown = true;
    this.closeSockets();
  }

  private async connectSocket(
    socket: MarketsWebSocket | PrivateWebSocket,
    active: () => boolean,
  ) {
    let timer: ReturnType<typeof setInterval> | undefined;
    const started = Date.now();
    try {
      await Promise.race([
        socket.connect().then(() => {
          if (!active()) {
            socket.close();
            throw new RequestCancelledError("Connection canceled.");
          }
        }),
        new Promise<never>((_, reject) => {
          timer = setInterval(() => {
            if (!active() || Date.now() - started >= 8_000) {
              socket.close();
              reject(
                !active()
                  ? new RequestCancelledError("Connection canceled.")
                  : new Error("WebSocket connection timed out."),
              );
            }
          }, 100);
        }),
      ]);
    } finally {
      if (timer) clearInterval(timer);
    }
  }

  private async refreshBalances() {
    const sequence = this.balanceSequence;
    const balances = await this.adapter.getBalances();
    // A newer private-stream event must not be overwritten by an older REST snapshot.
    if (this.balanceSequence === sequence && !this.shuttingDown) {
      this.lastBalanceAt = Date.now();
      this.store.updateRuntime(balances);
    }
  }

  private async refreshLiveMarkets() {
    const events: NonNullable<RawLiveEventsResponse["events"]> = [];
    const revision = this.store.getConfig().revision;
    const check = () => {
      const config = this.store.getConfig();
      if (this.shuttingDown || !config.enabled || config.revision !== revision)
        throw new RequestCancelledError("Discovery canceled.");
    };
    for (let page = 0; page < MAX_LIVE_EVENT_PAGES; page += 1) {
      const response = await this.rest.request<RawLiveEventsResponse>(
        "/v1/events",
        {
          authenticated: false,
          beforeSend: check,
          query: {
            limit: 100,
            offset: page * 100,
            active: true,
            closed: false,
            ended: false,
            live: true,
            categories: ["sports"],
          },
        },
      );
      check();
      const pageEvents = response.events || [];
      events.push(...pageEvents);
      if (pageEvents.length < 100) break;
    }
    const markets = extractLiveMarkets({ events });
    this.store.updateRuntime({
      liveEvents: new Set(markets.map((market) => market.eventSlug)).size,
      monitoredMarkets: markets.length,
    });
    if (
      this.marketSocket?.isConnected &&
      sameSlugs(this.trackedMarkets, markets)
    ) {
      this.trackedMarkets = new Map(
        markets.map((market) => [market.marketSlug, market]),
      );
      this.lastDiscoveryAt = Date.now();
      return;
    }
    this.closeMarketSocket();
    this.trackedMarkets = new Map(
      markets.map((market) => [market.marketSlug, market]),
    );
    this.lastDiscoveryAt = Date.now();
    if (!markets.length) return;
    const socket = this.client.ws.markets();
    this.marketSocket = socket;
    socket.on("marketDataLite", (message) => {
      if (this.marketSocket === socket) this.enqueueQuote(message);
    });
    socket.on("error", (error) => {
      if (this.marketSocket === socket) this.handleAsyncWorkerError(error);
    });
    socket.on("close", () => {
      if (this.marketSocket === socket) {
        this.closeMarketSocket();
        this.lastDiscoveryAt = 0;
      }
    });
    await this.connectSocket(
      socket,
      () =>
        !this.shuttingDown &&
        this.marketSocket === socket &&
        this.store.getConfig().enabled,
    );
    this.subscriptionsStartedAt = Date.now();
    chunk(
      markets.map((market) => market.marketSlug),
      MAX_MARKETS_PER_SUBSCRIPTION,
    ).forEach((slugs, index) => {
      const id = `bbbm-live-${index + 1}`;
      this.pendingSubscriptions.add(id);
      for (const slug of slugs) this.subscriptionByMarket.set(slug, id);
      socket.subscribeMarketDataLite(id, slugs);
    });
  }

  private readCurrent(slug: string): QuoteState | null {
    const market = this.trackedMarkets.get(slug);
    const latest = this.latestQuotes.get(slug);
    const runtime = this.store.getRuntime();
    if (
      !market ||
      !latest ||
      Date.now() - latest.at > 5_000 ||
      Date.now() - this.lastBalanceAt > 65_000 ||
      !this.marketSocket?.isConnected ||
      !this.privateSocket?.isConnected ||
      !this.privateBalanceReady ||
      !this.privateOrdersReady ||
      runtime.currentBalance === null ||
      runtime.buyingPower === null
    )
      return null;
    const reserve = this.store.uncertainCashReserve(slug);
    return {
      market,
      quote: latest.quote,
      balances: {
        currentBalance: runtime.currentBalance - reserve,
        buyingPower: runtime.buyingPower - reserve,
      },
    };
  }

  private enqueueQuote(message: MarketDataLite) {
    if (this.shuttingDown) return;
    const slug = message.marketDataLite.marketSlug;
    if (!this.trackedMarkets.has(slug)) return;
    const subscription = this.subscriptionByMarket.get(slug);
    if (subscription) this.pendingSubscriptions.delete(subscription);
    this.latestQuotes.set(slug, {
      quote: {
        bestBid: amountValue(message.marketDataLite.bestBid),
        bestAsk: amountValue(message.marketDataLite.bestAsk),
      },
      at: Date.now(),
      sequence: ++this.quoteSequence,
    });
    this.scheduleMarket(slug);
  }

  private scheduleMarket(slug: string) {
    if (
      this.shuttingDown ||
      !this.store.getConfig().enabled ||
      this.pendingWorkerError
    )
      return;
    const previous = this.store.getAttempt(slug);
    if (previous && previous.status !== "retryable") return;
    if (!this.marketWorkGate.begin(slug)) return;
    const generation = this.quoteQueueGeneration;
    let observedSequence = this.latestQuotes.get(slug)?.sequence;
    this.qualifiedQuoteQueue = this.qualifiedQuoteQueue
      .then(async () => {
        const canceled = () =>
          this.shuttingDown ||
          generation !== this.quoteQueueGeneration ||
          this.pendingWorkerError !== null;
        if (canceled()) return;
        const state = this.readCurrent(slug);
        observedSequence = this.latestQuotes.get(slug)?.sequence;
        if (!state) return;
        const result = await this.engine.processQuote({
          ...state,
          readCurrent: () => this.readCurrent(slug),
          isCancelled: canceled,
        });
        if (result !== "ignored" && !this.shuttingDown)
          await this.refreshBalances();
      })
      .catch((error) => {
        if (!this.shuttingDown && !(error instanceof RequestCancelledError))
          this.handleAsyncWorkerError(error);
      })
      .finally(() => {
        this.marketWorkGate.end(slug);
        if (this.latestQuotes.get(slug)?.sequence !== observedSequence)
          this.scheduleMarket(slug);
      });
  }

  private async tryPrivateSocket() {
    if (this.privateSocket?.isConnected) return;
    if (Date.now() - this.lastPrivateAttemptAt < PRIVATE_RECONNECT_INTERVAL_MS)
      return;
    this.lastPrivateAttemptAt = Date.now();
    const socket = this.client.ws.private();
    this.privateSocket = socket;
    socket.on("orderUpdate", (message) => {
      if (this.privateSocket === socket) this.handleOrderUpdate(message);
    });
    socket.on("orderSnapshot", (message) => {
      if (this.privateSocket !== socket) return;
      this.privateOrdersReady = true;
      const envelope = message as unknown as {
        orderSubscriptionSnapshot?: {
          orders?: ParsedOrderExecution["order"][];
        };
        ordersSnapshot?: { orders?: ParsedOrderExecution["order"][] };
      };
      for (const order of (
        envelope.orderSubscriptionSnapshot || envelope.ordersSnapshot
      )?.orders || [])
        this.engine.handleOrderExecution({ order });
      for (const slug of this.latestQuotes.keys()) this.scheduleMarket(slug);
    });
    socket.on("accountBalanceSnapshot", (message) => {
      if (this.privateSocket === socket) this.handleAccountBalances(message);
    });
    socket.on("accountBalanceUpdate", (message) => {
      if (this.privateSocket === socket) this.handleAccountBalances(message);
    });
    socket.on("error", (error) => {
      if (this.privateSocket === socket) this.handleAsyncWorkerError(error);
    });
    socket.on("close", () => {
      if (this.privateSocket === socket) {
        this.privateSocket = null;
        this.privateBalanceReady = false;
        this.privateOrdersReady = false;
        this.quoteQueueGeneration += 1;
      }
    });
    await this.connectSocket(
      socket,
      () =>
        !this.shuttingDown &&
        this.privateSocket === socket &&
        this.store.getConfig().enabled,
    );
    socket.subscribeOrders("bbbm-orders");
    socket.subscribeAccountBalance("bbbm-balance");
  }

  private handleAsyncWorkerError(error: unknown) {
    if (this.shuttingDown) return;
    this.pendingWorkerError = error;
    // Invalidate all evaluations immediately, rather than leaving a failed subscription Armed.
    this.closeSockets();
    this.store.updateRuntime({
      state: "error",
      lastError: publicWorkerError(error),
      stopReason: "Reconnecting to Polymarket.",
    });
  }
  private throwPendingError() {
    if (this.pendingWorkerError !== null) throw this.pendingWorkerError;
  }
  private handleOrderUpdate(message: unknown) {
    const execution = extractOrderExecution(message);
    if (execution) {
      this.engine.handleOrderExecution(execution);
      this.scheduleMarket(execution.order.marketSlug);
    }
  }
  private handleAccountBalances(message: unknown) {
    const balances = extractAccountBalances(message);
    if (!balances || this.shuttingDown) return;
    this.privateBalanceReady = true;
    this.balanceSequence += 1;
    this.lastBalanceAt = Date.now();
    this.store.updateRuntime(balances);
    for (const slug of this.latestQuotes.keys()) this.scheduleMarket(slug);
  }
  private closeMarketSocket() {
    const socket = this.marketSocket;
    this.marketSocket = null;
    socket?.close();
    this.trackedMarkets.clear();
    this.latestQuotes.clear();
    this.pendingSubscriptions.clear();
    this.subscriptionByMarket.clear();
    this.subscriptionsStartedAt = 0;
    this.quoteQueueGeneration += 1;
  }
  private closeSockets() {
    this.closeMarketSocket();
    const socket = this.privateSocket;
    this.privateSocket = null;
    socket?.close();
    this.privateOrdersReady = false;
    this.privateBalanceReady = false;
    this.balanceSequence += 1;
    this.lastBalanceAt = 0;
    this.lastPrivateAttemptAt = 0;
    this.lastDiscoveryAt = 0;
  }
}
