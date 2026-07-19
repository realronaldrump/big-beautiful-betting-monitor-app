import type {
  MarketDataLite,
  MarketsWebSocket,
  PolymarketUS,
  PrivateWebSocket,
} from "polymarket-us";
import { AutomationEngine, type MarketQuote, type TrackedMarket } from "@/automation/engine";
import {
  extractLiveMarkets,
  type RawLiveEventsResponse,
} from "@/automation/live-markets";
import {
  ApiPacer,
  createPolymarketTradingClient,
  PolymarketTradingAdapter,
} from "@/automation/polymarket-adapter";
import { getAutomationStore, type AutomationStore } from "@/automation/store";
import { AUTOMATION_RULES } from "@/automation/strategy";
import {
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
  return message.includes("error 1015") || message.includes("being rate limited");
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

export class AutomationWorker {
  private readonly store: AutomationStore;
  private readonly client: PolymarketUS;
  private readonly pacer = new ApiPacer();
  private readonly adapter: PolymarketTradingAdapter;
  private readonly engine: AutomationEngine;
  private trackedMarkets = new Map<string, TrackedMarket>();
  private marketSocket: MarketsWebSocket | null = null;
  private privateSocket: PrivateWebSocket | null = null;
  private lastDiscoveryAt = 0;
  private lastBalanceAt = 0;
  private lastPrivateAttemptAt = 0;
  private rateLimitRetryMs = INITIAL_RATE_LIMIT_RETRY_MS;
  private lastRateLimitAt: number | null = null;
  private pendingRateLimitError: unknown | null = null;
  private readonly marketWorkGate = new MarketWorkGate();
  private quoteQueueGeneration = 0;
  private shuttingDown = false;
  private qualifiedQuoteQueue: Promise<void> = Promise.resolve();

  constructor() {
    this.store = getAutomationStore();
    this.client = createPolymarketTradingClient();
    this.adapter = new PolymarketTradingAdapter(this.client, this.pacer);
    this.engine = new AutomationEngine(this.store, this.adapter);
  }

  async run() {
    this.store.updateRuntime({
      state: "off",
      heartbeatAt: new Date().toISOString(),
      lastError: null,
      stopReason: null,
    });

    while (!this.shuttingDown) {
      const config = this.store.getConfig();
      const heartbeatAt = new Date().toISOString();

      if (!config.enabled) {
        this.closeSockets();
        this.pendingRateLimitError = null;
        this.rateLimitRetryMs = INITIAL_RATE_LIMIT_RETRY_MS;
        this.lastRateLimitAt = null;
        this.store.updateRuntime({
          state: "off",
          heartbeatAt,
          lastError: null,
          stopReason: null,
          liveEvents: 0,
          monitoredMarkets: 0,
        });
        await sleep(LOOP_INTERVAL_MS);
        continue;
      }

      try {
        this.throwPendingRateLimitError();
        await this.tryPrivateSocket();

        if (Date.now() - this.lastBalanceAt >= BALANCE_INTERVAL_MS) {
          const balances = await this.adapter.getBalances();
          this.lastBalanceAt = Date.now();
          this.store.updateRuntime({
            currentBalance: balances.currentBalance,
            buyingPower: balances.buyingPower,
          });
        }

        const runtime = this.store.getRuntime();
        const balanceWouldCrossFloor =
          runtime.currentBalance === null ||
          runtime.currentBalance - 1 < config.balanceFloor;
        if (balanceWouldCrossFloor || (runtime.buyingPower ?? 0) < 1) {
          this.closeMarketSocket();
          this.store.updateRuntime({
            state: "stopped",
            heartbeatAt,
            lastError: null,
            stopReason: balanceWouldCrossFloor
              ? `Balance floor reached — ${config.balanceFloor.toFixed(2)} dollars is protected.`
              : "Buying power is below the one-dollar stake.",
            liveEvents: 0,
            monitoredMarkets: 0,
          });
          await sleep(LOOP_INTERVAL_MS);
          continue;
        }

        if (
          !this.marketSocket ||
          Date.now() - this.lastDiscoveryAt >= DISCOVERY_INTERVAL_MS
        ) {
          await this.refreshLiveMarkets();
        }

        this.store.updateRuntime({
          state: "watching",
          heartbeatAt,
          lastError: null,
          stopReason: null,
          monitoredMarkets: this.trackedMarkets.size,
        });
        const now = Date.now();
        if (hasSustainedRateLimitRecovery(this.lastRateLimitAt, now)) {
          this.rateLimitRetryMs = INITIAL_RATE_LIMIT_RETRY_MS;
          this.lastRateLimitAt = null;
        }
      } catch (error) {
        const rateLimited = isRateLimitError(error);
        if (rateLimited) this.lastRateLimitAt = Date.now();
        const retry = retryPlan(error, this.rateLimitRetryMs);
        this.rateLimitRetryMs = retry.nextRateLimitDelayMs;
        if (rateLimited) this.closeSockets();
        else this.closeMarketSocket();
        this.store.updateRuntime({
          state: "error",
          heartbeatAt,
          lastError: publicWorkerError(error),
          stopReason: "The worker will retry automatically.",
        });
        await waitForRetryOrConfigChange({
          delayMs: retry.delayMs,
          initialConfigUpdatedAt: config.updatedAt,
          readConfigUpdatedAt: () => this.store.getConfig().updatedAt,
          isStopping: () => this.shuttingDown,
        });
        continue;
      }

      await sleep(LOOP_INTERVAL_MS);
    }

    this.closeSockets();
    this.store.updateRuntime({
      state: "off",
      heartbeatAt: new Date().toISOString(),
      stopReason: "Automation worker stopped.",
    });
  }

  stop() {
    this.shuttingDown = true;
  }

  private async refreshLiveMarkets() {
    const events: NonNullable<RawLiveEventsResponse["events"]> = [];
    for (let page = 0; page < MAX_LIVE_EVENT_PAGES; page += 1) {
      const response = await this.pacer.run(() =>
        this.client.get<RawLiveEventsResponse>("/v1/events", {
          query: {
            limit: 100,
            offset: page * 100,
            active: true,
            closed: false,
            ended: false,
            live: true,
            categories: ["sports"],
          },
        }),
      );
      const pageEvents = response.events || [];
      events.push(...pageEvents);
      if (pageEvents.length < 100) break;
    }
    const markets = extractLiveMarkets({ events });
    const liveEvents = new Set(markets.map((market) => market.eventSlug)).size;
    this.store.updateRuntime({ liveEvents, monitoredMarkets: markets.length });

    if (this.marketSocket?.isConnected && sameSlugs(this.trackedMarkets, markets)) {
      this.trackedMarkets = new Map(markets.map((market) => [market.marketSlug, market]));
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
    socket.on("marketDataLite", (message) => this.enqueueQuote(message));
    socket.on("error", (error) => {
      if (this.shuttingDown) return;
      this.handleAsyncWorkerError(error);
    });
    socket.on("close", () => {
      if (this.marketSocket === socket) this.marketSocket = null;
    });
    await socket.connect();

    chunk(
      markets.map((market) => market.marketSlug),
      MAX_MARKETS_PER_SUBSCRIPTION,
    ).forEach((marketSlugs, index) => {
      socket.subscribeMarketDataLite(`bbbm-live-${index + 1}`, marketSlugs);
    });
  }

  private enqueueQuote(message: MarketDataLite) {
    if (this.shuttingDown) return;
    const config = this.store.getConfig();
    if (!config.enabled) return;
    const marketSlug = message.marketDataLite.marketSlug;
    const market = this.trackedMarkets.get(marketSlug);
    if (!market) return;

    const quote: MarketQuote = {
      bestBid: amountValue(message.marketDataLite.bestBid),
      bestAsk: amountValue(message.marketDataLite.bestAsk),
    };
    const longQualifies =
      quote.bestAsk !== undefined &&
      quote.bestAsk >= config.triggerPrice &&
      quote.bestAsk <= AUTOMATION_RULES.maxPrice;
    const shortPrice =
      quote.bestBid === undefined
        ? undefined
        : Number((1 - quote.bestBid).toFixed(6));
    const shortQualifies =
      shortPrice !== undefined &&
      shortPrice >= config.triggerPrice &&
      shortPrice <= AUTOMATION_RULES.maxPrice;
    if (!longQualifies && !shortQualifies) return;

    const previous = this.store.getAttempt(marketSlug);
    if (previous && previous.status !== "retryable") return;
    if (!this.marketWorkGate.begin(marketSlug)) return;
    const generation = this.quoteQueueGeneration;

    this.qualifiedQuoteQueue = this.qualifiedQuoteQueue
      .then(async () => {
        if (
          this.shuttingDown ||
          generation !== this.quoteQueueGeneration ||
          !this.store.getConfig().enabled
        ) {
          return;
        }

        const runtime = this.store.getRuntime();
        const balances =
          runtime.currentBalance === null || runtime.buyingPower === null
            ? await this.adapter.getBalances()
            : {
                currentBalance: runtime.currentBalance,
                buyingPower: runtime.buyingPower,
              };
        const result = await this.engine.processQuote({ market, quote, balances });

        if (result !== "ignored") {
          const refreshed = await this.adapter.getBalances();
          this.store.updateRuntime(refreshed);
          this.lastBalanceAt = Date.now();
        }
      })
      .catch((error) => {
        if (this.shuttingDown) return;
        this.handleAsyncWorkerError(error);
      })
      .finally(() => this.marketWorkGate.end(marketSlug));
  }

  private async ensurePrivateSocket() {
    if (this.privateSocket?.isConnected) return;
    this.privateSocket?.close();

    const socket = this.client.ws.private();
    this.privateSocket = socket;
    socket.on("orderUpdate", (message) => this.handleOrderUpdate(message));
    socket.on("accountBalanceSnapshot", (message) =>
      this.handleAccountBalances(message),
    );
    socket.on("accountBalanceUpdate", (message) =>
      this.handleAccountBalances(message),
    );
    socket.on("error", (error) => {
      if (this.shuttingDown) return;
      this.handleAsyncWorkerError(error);
    });
    socket.on("close", () => {
      if (this.privateSocket === socket) this.privateSocket = null;
    });
    await socket.connect();
    socket.subscribeOrders("bbbm-orders");
    socket.subscribeAccountBalance("bbbm-balance");
  }

  private async tryPrivateSocket() {
    if (this.privateSocket?.isConnected) return;
    if (Date.now() - this.lastPrivateAttemptAt < PRIVATE_RECONNECT_INTERVAL_MS) {
      return;
    }

    this.lastPrivateAttemptAt = Date.now();
    try {
      await this.ensurePrivateSocket();
    } catch (error) {
      this.privateSocket?.close();
      this.privateSocket = null;
      if (isRateLimitError(error)) throw error;
      this.store.updateRuntime({ lastError: publicWorkerError(error) });
    }
  }

  private handleAsyncWorkerError(error: unknown) {
    if (isRateLimitError(error)) {
      this.pendingRateLimitError = error;
      return;
    }
    this.store.updateRuntime({ lastError: publicWorkerError(error) });
  }

  private throwPendingRateLimitError() {
    if (this.pendingRateLimitError === null) return;
    const error = this.pendingRateLimitError;
    this.pendingRateLimitError = null;
    throw error;
  }

  private handleOrderUpdate(message: unknown) {
    if (this.shuttingDown) return;
    const execution = extractOrderExecution(message);
    if (!execution) return;
    const marketSlug = execution.order.marketSlug;

    if (
      execution.type === "EXECUTION_TYPE_FILL" ||
      execution.type === "EXECUTION_TYPE_PARTIAL_FILL" ||
      execution.order.state === "ORDER_STATE_FILLED" ||
      execution.order.state === "ORDER_STATE_PARTIALLY_FILLED" ||
      Number(execution.order.cumQuantity || 0) > 0
    ) {
      this.store.markFilled(marketSlug, execution.order.id);
      return;
    }
    if (
      execution.type === "EXECUTION_TYPE_REJECTED" ||
      execution.order.state === "ORDER_STATE_REJECTED"
    ) {
      this.store.markExplicitRejection(
        marketSlug,
        execution.text || execution.orderRejectReason || "Order rejected by Polymarket",
      );
    }
  }

  private handleAccountBalances(message: unknown) {
    if (this.shuttingDown) return;
    const balances = extractAccountBalances(message);
    if (!balances) return;
    this.lastBalanceAt = Date.now();
    this.store.updateRuntime(balances);
  }

  private closeMarketSocket() {
    const socket = this.marketSocket;
    this.marketSocket = null;
    socket?.close();
    this.trackedMarkets.clear();
    this.lastDiscoveryAt = 0;
    this.quoteQueueGeneration += 1;
  }

  private closeSockets() {
    this.closeMarketSocket();
    const privateSocket = this.privateSocket;
    this.privateSocket = null;
    privateSocket?.close();
    this.lastBalanceAt = 0;
    this.lastPrivateAttemptAt = 0;
  }
}
