import { EventEmitter } from "node:events";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CreateOrderParams, PolymarketUS } from "polymarket-us";
import { AutomationStore } from "./store";
import { AutomationWorker } from "./worker-runtime";
import type { TradingAdapter } from "./engine";
import type { PolymarketRestClient } from "@/lib/polymarket-rest";

class Socket extends EventEmitter {
  isConnected = false;
  subscribeCalls = 0;
  fail = false;
  snapshotBalance = true;
  async connect() {
    this.isConnected = true;
  }
  close() {
    this.isConnected = false;
    this.emit("close");
  }
  subscribeOrders() {}
  subscribe(_id: string, type: string) {
    if (type !== "SUBSCRIPTION_TYPE_ORDER_SNAPSHOT")
      throw new Error("Explicit order snapshot required");
    this.emit("orderSnapshot", {
      orderSubscriptionSnapshot: { orders: [], eof: true },
    });
  }
  subscribeAccountBalance() {
    if (this.snapshotBalance) this.balance(250);
  }
  subscribeMarketDataLite() {
    this.subscribeCalls++;
    if (this.fail) this.emit("error", new Error("subscription rejected"));
    else this.quote(0.5);
  }
  quote(ask: number) {
    this.emit("marketDataLite", {
      marketDataLite: {
        marketSlug: "m",
        bestAsk: { value: String(ask) },
        bestBid: { value: String(ask - 0.01) },
      },
    });
  }
  balance(value: number) {
    this.emit("accountBalanceSnapshot", {
      accountBalanceSubscriptionSnapshot: {
        balance: value,
        buyingPower: value,
      },
    });
  }
}
const live = {
  events: [
    {
      slug: "event",
      live: true,
      markets: [
        {
          slug: "m",
          title: "Market",
          active: true,
          minimumTradeQty: 0.01,
          orderPriceMinTickSize: 0.01,
        },
      ],
    },
  ],
};
const fixtures: {
  store: AutomationStore;
  worker: AutomationWorker;
  running: Promise<void>;
}[] = [];
function fixture(
  options: {
    empty?: boolean;
    enabled?: boolean;
    credentials?: boolean;
    failSubscription?: boolean;
    noBalanceSnapshot?: boolean;
  } = {},
) {
  const store = new AutomationStore(":memory:");
  store.updateConfig({
    enabled: options.enabled !== false,
    balanceFloor: 100,
    triggerPrice: 0.95,
    executionCap: 0.96,
  });
  const markets: Socket[] = [];
  const privates: Socket[] = [];
  const sent: CreateOrderParams[] = [];
  const client = {
    ws: {
      markets: () => {
        const socket = new Socket();
        socket.fail = !!options.failSubscription && markets.length === 0;
        markets.push(socket);
        return socket;
      },
      private: () => {
        const socket = new Socket();
        socket.snapshotBalance = !options.noBalanceSnapshot;
        privates.push(socket);
        return socket;
      },
    },
  } as unknown as PolymarketUS;
  const request = vi
    .fn()
    .mockResolvedValue(options.empty ? { events: [] } : live);
  const adapter: TradingAdapter = {
    previewOrder: vi.fn().mockResolvedValue({}),
    createOrder: vi.fn(async (order, check) => {
      check();
      sent.push(order);
      return { id: "order", executions: [] };
    }),
    getBalances: vi
      .fn()
      .mockResolvedValue({ currentBalance: 250, buyingPower: 250 }),
    getQuote: vi.fn(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
  const worker = new AutomationWorker({
    store,
    client,
    adapter,
    rest: { request } as unknown as PolymarketRestClient,
    credentialsAvailable: () => options.credentials !== false,
  });
  const running = worker.run();
  const item = {
    store,
    worker,
    running,
    markets,
    privates,
    sent,
    adapter,
    request,
  };
  fixtures.push(item);
  return item;
}
beforeEach(() => vi.useFakeTimers());
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    f.worker.stop();
    await vi.advanceTimersByTimeAsync(5000);
    await f.running;
    f.store.close();
  }
  vi.useRealTimers();
});
it("does not trade a queued obsolete qualifying quote", async () => {
  const f = fixture();
  await vi.advanceTimersByTimeAsync(0);
  f.markets[0].quote(0.95);
  f.markets[0].quote(0.5);
  await vi.advanceTimersByTimeAsync(0);
  expect(f.sent).toHaveLength(0);
});
it("rechecks a new balance during preview before dispatch", async () => {
  const f = fixture();
  await vi.advanceTimersByTimeAsync(0);
  vi.mocked(f.adapter.previewOrder).mockImplementation(async () => {
    f.privates[0].balance(100.5);
  });
  f.markets[0].quote(0.95);
  await vi.advanceTimersByTimeAsync(0);
  expect(f.sent).toHaveLength(0);
  expect(f.store.getAttempt("m")?.status).toBe("retryable");
});
it("invalidates a preview when its market is removed or the worker stops", async () => {
  const f = fixture();
  await vi.advanceTimersByTimeAsync(0);
  let release!: () => void;
  vi.mocked(f.adapter.previewOrder).mockImplementation(
    () => new Promise((r) => (release = () => r({}))),
  );
  f.markets[0].quote(0.95);
  await vi.advanceTimersByTimeAsync(0);
  f.worker.stop();
  release();
  await vi.advanceTimersByTimeAsync(0);
  expect(f.sent).toHaveLength(0);
});
it("ignores unrelated rejected orders in an already filled market", async () => {
  const f = fixture();
  await vi.advanceTimersByTimeAsync(0);
  f.store.beginAttempt({
    marketSlug: "m",
    eventSlug: "e",
    title: "M",
    outcome: "Yes",
    triggerPrice: 0.95,
  });
  f.store.markFilled("m", "original");
  f.privates[0].emit("orderUpdate", {
    orderSubscriptionUpdate: {
      execution: {
        type: "EXECUTION_TYPE_REJECTED",
        order: { id: "manual", marketSlug: "m", state: "ORDER_STATE_REJECTED" },
      },
    },
  });
  f.markets[0].quote(0.95);
  await vi.advanceTimersByTimeAsync(0);
  expect(f.store.getAttempt("m")?.status).toBe("filled");
  expect(f.sent).toHaveLength(0);
});
it("preserves an execution received before its REST acknowledgement", async () => {
  const f = fixture();
  await vi.advanceTimersByTimeAsync(0);
  vi.mocked(f.adapter.createOrder).mockImplementation(async (order, check) => {
    check();
    f.sent.push(order);
    f.privates[0].emit("orderUpdate", {
      orderSubscriptionUpdate: {
        execution: {
          type: "EXECUTION_TYPE_REJECTED",
          order: {
            id: "early",
            marketSlug: "m",
            state: "ORDER_STATE_REJECTED",
          },
        },
      },
    });
    f.markets[0].quote(0.5);
    return { id: "early" };
  });
  f.markets[0].quote(0.95);
  await vi.advanceTimersByTimeAsync(1100);
  expect(f.sent).toHaveLength(1);
  expect(f.store.getAttempt("m")?.status).toBe("retryable");
});
it("keeps discovery at fifteen seconds when no markets are live", async () => {
  const f = fixture({ empty: true });
  await vi.advanceTimersByTimeAsync(2100);
  expect(f.request).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(13000);
  expect(f.request).toHaveBeenCalledTimes(2);
});
it("clears stale worker cash while off", async () => {
  const f = fixture({ enabled: false });
  f.store.updateRuntime({ currentBalance: 250, buyingPower: 250 });
  await vi.advanceTimersByTimeAsync(1000);
  expect(f.store.getRuntime().currentBalance).toBeNull();
});
it("keeps a credential-free demo worker alive without exchange access", async () => {
  const f = fixture({ credentials: false });
  await vi.advanceTimersByTimeAsync(2000);
  expect(f.store.getRuntime().heartbeatAt).toBeTruthy();
  expect(f.markets).toHaveLength(0);
  expect(f.privates).toHaveLength(0);
  expect(f.request).not.toHaveBeenCalled();
});
it("reconnects failed subscriptions and never calls them Armed", async () => {
  const f = fixture({ failSubscription: true });
  await vi.advanceTimersByTimeAsync(0);
  expect(f.store.getRuntime()).toMatchObject({
    state: "error",
    lastError: "subscription rejected",
  });
  await vi.advanceTimersByTimeAsync(15000);
  expect(f.markets).toHaveLength(2);
  expect(f.store.getRuntime()).toMatchObject({
    state: "watching",
    lastError: null,
  });
});

it("bootstraps an idle balance change stream without waiting for a nonexistent initial snapshot", async () => {
  const f = fixture({ noBalanceSnapshot: true });
  await vi.advanceTimersByTimeAsync(1000);
  expect(f.adapter.getBalances).toHaveBeenCalledTimes(1);
  expect(f.store.getRuntime().state).toBe("watching");
  f.privates[0].emit("message", {
    accountBalancesUpdate: {
      balanceChange: {
        afterBalance: {
          currentBalance: 102,
          buyingPower: 102,
          displayedCash: 102,
        },
      },
    },
  });
  expect(f.store.getRuntime().currentBalance).toBe(102);
});
