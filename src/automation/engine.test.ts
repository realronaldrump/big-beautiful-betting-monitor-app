import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AutomationEngine, type TradingAdapter } from "@/automation/engine";
import { AutomationStore } from "@/automation/store";

describe("AutomationEngine", () => {
  const testDirectories: string[] = [];

  afterEach(() => {
    for (const directory of testDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  function makeStore() {
    const directory = mkdtempSync(path.join(tmpdir(), "bbbm-engine-"));
    testDirectories.push(directory);
    return new AutomationStore(path.join(directory, "automation.sqlite"));
  }

  it("submits at a configured trigger with the configured execution cap", async () => {
    const store = makeStore();
    const previewOrder = vi.fn().mockResolvedValue(undefined);
    const createOrder = vi.fn().mockResolvedValue({ id: "order-1", executions: [] });
    const adapter: TradingAdapter = {
      previewOrder,
      createOrder,
      getQuote: vi.fn(),
      getBalances: vi.fn(),
      sleep: vi.fn(),
    };
    const engine = new AutomationEngine(store, adapter);
    store.updateConfig({
      enabled: true,
      balanceFloor: 100,
      triggerPrice: 0.9,
      executionCap: 0.92,
    });

    await engine.processQuote({
      market: {
        marketSlug: "rockies-win",
        eventSlug: "rockies-v-dodgers",
        eventTitle: "Rockies v Dodgers",
        marketTitle: "Rockies win",
        longOutcome: "Yes",
        shortOutcome: "No",
        minimumTradeQty: 0.01,
        priceTickSize: 0.01,
        isLive: true,
        isOpen: true,
      },
      quote: { bestBid: 0.89, bestAsk: 0.9 },
      balances: { currentBalance: 250, buyingPower: 100 },
    });

    expect(previewOrder).toHaveBeenCalledTimes(1);
    expect(createOrder).toHaveBeenCalledWith({
      marketSlug: "rockies-win",
      intent: "ORDER_INTENT_BUY_LONG",
      type: "ORDER_TYPE_LIMIT",
      price: { value: "0.92", currency: "USD" },
      quantity: 1.08,
      tif: "TIME_IN_FORCE_IMMEDIATE_OR_CANCEL",
      participateDontInitiate: false,
      manualOrderIndicator: "MANUAL_ORDER_INDICATOR_AUTOMATIC",
      synchronousExecution: true,
    });
    expect(store.getAttempt("rockies-win")).toMatchObject({
      status: "submitted",
      orderId: "order-1",
      attempts: 1,
    });

    store.close();
  });

  it("does not submit a previewed order after the execution cap changes", async () => {
    const store = makeStore();
    store.updateConfig({
      enabled: true,
      balanceFloor: 100,
      triggerPrice: 0.9,
      executionCap: 0.92,
    });
    const createOrder = vi.fn();
    const adapter: TradingAdapter = {
      previewOrder: vi.fn().mockImplementation(async () => {
        store.updateConfig({
          enabled: true,
          balanceFloor: 100,
          triggerPrice: 0.9,
          executionCap: 0.91,
        });
      }),
      createOrder,
      getQuote: vi.fn(),
      getBalances: vi.fn(),
      sleep: vi.fn(),
    };
    const engine = new AutomationEngine(store, adapter);

    const result = await engine.processQuote({
      market: {
        marketSlug: "cap-changed",
        eventSlug: "cap-changed-event",
        eventTitle: "Cap changed event",
        marketTitle: "Cap changed market",
        longOutcome: "Yes",
        shortOutcome: "No",
        minimumTradeQty: 0.01,
        priceTickSize: 0.01,
        isLive: true,
        isOpen: true,
      },
      quote: { bestBid: 0.89, bestAsk: 0.9 },
      balances: { currentBalance: 250, buyingPower: 100 },
    });

    expect(result).toBe("ignored");
    expect(createOrder).not.toHaveBeenCalled();
    expect(store.getAttempt("cap-changed")).toMatchObject({
      status: "retryable",
      attempts: 0,
      lastError: "Automation settings changed before submission",
    });

    store.close();
  });

  it("uses the inverse four-cent limit when the NO side reaches 95 cents", async () => {
    const store = makeStore();
    store.updateConfig({
      enabled: true,
      balanceFloor: 100,
      triggerPrice: 0.95,
      executionCap: 0.96,
    });
    const createOrder = vi.fn().mockResolvedValue({ id: "order-no", executions: [] });
    const adapter: TradingAdapter = {
      previewOrder: vi.fn().mockResolvedValue(undefined),
      createOrder,
      getQuote: vi.fn(),
      getBalances: vi.fn(),
      sleep: vi.fn(),
    };
    const engine = new AutomationEngine(store, adapter);

    await engine.processQuote({
      market: {
        marketSlug: "broncos-cover",
        eventSlug: "broncos-v-chiefs",
        eventTitle: "Broncos v Chiefs",
        marketTitle: "Broncos cover",
        longOutcome: "Yes",
        shortOutcome: "No",
        minimumTradeQty: 0.01,
        priceTickSize: 0.01,
        isLive: true,
        isOpen: true,
      },
      quote: { bestBid: 0.05, bestAsk: 0.06 },
      balances: { currentBalance: 250, buyingPower: 100 },
    });

    expect(createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: "ORDER_INTENT_BUY_SHORT",
        price: { value: "0.04", currency: "USD" },
        quantity: 1.04,
      }),
    );
    expect(store.getAttempt("broncos-cover")?.outcome).toBe("No");

    store.close();
  });

  it("rechecks the quote and balance across three rejection retries", async () => {
    const store = makeStore();
    store.updateConfig({
      enabled: true,
      balanceFloor: 100,
      triggerPrice: 0.95,
      executionCap: 0.96,
    });
    const rejected = {
      id: "rejected-order",
      executions: [
        {
          type: "EXECUTION_TYPE_REJECTED" as const,
          text: "risk check rejected",
          order: { state: "ORDER_STATE_REJECTED" as const },
        },
      ],
    };
    const filled = {
      id: "filled-order",
      executions: [
        {
          type: "EXECUTION_TYPE_FILL" as const,
          order: { state: "ORDER_STATE_FILLED" as const },
        },
      ],
    };
    const createOrder = vi
      .fn()
      .mockResolvedValueOnce(rejected)
      .mockResolvedValueOnce(rejected)
      .mockResolvedValueOnce(rejected)
      .mockResolvedValueOnce(filled);
    const sleep = vi.fn().mockResolvedValue(undefined);
    const getQuote = vi.fn().mockResolvedValue({ bestBid: 0.94, bestAsk: 0.95 });
    const getBalances = vi
      .fn()
      .mockResolvedValue({ currentBalance: 250, buyingPower: 100 });
    const adapter: TradingAdapter = {
      previewOrder: vi.fn().mockResolvedValue(undefined),
      createOrder,
      getQuote,
      getBalances,
      sleep,
    };
    const engine = new AutomationEngine(store, adapter);

    await engine.processQuote({
      market: {
        marketSlug: "nuggets-win",
        eventSlug: "nuggets-v-lakers",
        eventTitle: "Nuggets v Lakers",
        marketTitle: "Nuggets win",
        longOutcome: "Nuggets",
        shortOutcome: "Lakers",
        minimumTradeQty: 0.01,
        priceTickSize: 0.01,
        isLive: true,
        isOpen: true,
      },
      quote: { bestBid: 0.94, bestAsk: 0.95 },
      balances: { currentBalance: 250, buyingPower: 100 },
    });

    expect(createOrder).toHaveBeenCalledTimes(4);
    expect(sleep.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([
      1_000,
      2_000,
      4_000,
    ]);
    expect(getQuote).toHaveBeenCalledTimes(3);
    expect(getBalances).toHaveBeenCalledTimes(3);
    expect(store.getAttempt("nuggets-win")).toMatchObject({
      status: "filled",
      attempts: 4,
      orderId: "filled-order",
    });

    store.close();
  });

  it("does not retry an ambiguous network failure that might have placed the order", async () => {
    const store = makeStore();
    store.updateConfig({
      enabled: true,
      balanceFloor: 100,
      triggerPrice: 0.95,
      executionCap: 0.96,
    });
    const createOrder = vi.fn().mockRejectedValue(new Error("connection reset"));
    const adapter: TradingAdapter = {
      previewOrder: vi.fn().mockResolvedValue(undefined),
      createOrder,
      getQuote: vi.fn(),
      getBalances: vi.fn(),
      sleep: vi.fn(),
    };
    const engine = new AutomationEngine(store, adapter);

    const result = await engine.processQuote({
      market: {
        marketSlug: "avalanche-win",
        eventSlug: "avalanche-v-stars",
        eventTitle: "Avalanche v Stars",
        marketTitle: "Avalanche win",
        longOutcome: "Avalanche",
        shortOutcome: "Stars",
        minimumTradeQty: 0.01,
        priceTickSize: 0.01,
        isLive: true,
        isOpen: true,
      },
      quote: { bestBid: 0.94, bestAsk: 0.95 },
      balances: { currentBalance: 250, buyingPower: 100 },
    });

    expect(result).toBe("ambiguous");
    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(store.getAttempt("avalanche-win")?.status).toBe("ambiguous");

    store.close();
  });

  it("returns rate limits to the worker without consuming an order attempt", async () => {
    const store = makeStore();
    store.updateConfig({
      enabled: true,
      balanceFloor: 100,
      triggerPrice: 0.75,
      executionCap: 0.96,
    });
    const rateLimit = Object.assign(new Error("Too Many Requests"), { status: 429 });
    const adapter: TradingAdapter = {
      previewOrder: vi.fn().mockRejectedValue(rateLimit),
      createOrder: vi.fn(),
      getQuote: vi.fn(),
      getBalances: vi.fn(),
      sleep: vi.fn(),
    };
    const engine = new AutomationEngine(store, adapter);

    await expect(
      engine.processQuote({
        market: {
          marketSlug: "rate-limited-market",
          eventSlug: "rate-limited-event",
          eventTitle: "Rate limited event",
          marketTitle: "Rate limited market",
          longOutcome: "Yes",
          shortOutcome: "No",
          minimumTradeQty: 0.01,
          priceTickSize: 0.01,
          isLive: true,
          isOpen: true,
        },
        quote: { bestBid: 0.74, bestAsk: 0.75 },
        balances: { currentBalance: 250, buyingPower: 100 },
      }),
    ).rejects.toBe(rateLimit);
    expect(store.getAttempt("rate-limited-market")).toMatchObject({
      status: "retryable",
      attempts: 0,
    });
    expect(adapter.createOrder).not.toHaveBeenCalled();

    store.close();
  });

  it("skips a market whose minimum quantity would cost more than one dollar", async () => {
    const store = makeStore();
    store.updateConfig({
      enabled: true,
      balanceFloor: 100,
      triggerPrice: 0.95,
      executionCap: 0.96,
    });
    const adapter: TradingAdapter = {
      previewOrder: vi.fn(),
      createOrder: vi.fn(),
      getQuote: vi.fn(),
      getBalances: vi.fn(),
      sleep: vi.fn(),
    };
    const engine = new AutomationEngine(store, adapter);

    const result = await engine.processQuote({
      market: {
        marketSlug: "large-minimum",
        eventSlug: "large-minimum-event",
        eventTitle: "Large minimum event",
        marketTitle: "Large minimum market",
        longOutcome: "Yes",
        shortOutcome: "No",
        minimumTradeQty: 2,
        priceTickSize: 0.01,
        isLive: true,
        isOpen: true,
      },
      quote: { bestBid: 0.94, bestAsk: 0.95 },
      balances: { currentBalance: 250, buyingPower: 100 },
    });

    expect(result).toBe("ignored");
    expect(adapter.previewOrder).not.toHaveBeenCalled();
    expect(adapter.createOrder).not.toHaveBeenCalled();
    expect(store.getAttempt("large-minimum")).toBeNull();

    store.close();
  });

  it("treats a partial fill as the market's one bet even if the remainder rejects", async () => {
    const store = makeStore();
    store.updateConfig({
      enabled: true,
      balanceFloor: 100,
      triggerPrice: 0.95,
      executionCap: 0.96,
    });
    const createOrder = vi.fn().mockResolvedValue({
      id: "partial-order",
      executions: [
        {
          type: "EXECUTION_TYPE_PARTIAL_FILL",
          order: { state: "ORDER_STATE_PARTIALLY_FILLED", cumQuantity: 0.5 },
        },
        {
          type: "EXECUTION_TYPE_REJECTED",
          text: "remainder rejected",
          order: { state: "ORDER_STATE_REJECTED", cumQuantity: 0.5 },
        },
      ],
    });
    const adapter: TradingAdapter = {
      previewOrder: vi.fn().mockResolvedValue(undefined),
      createOrder,
      getQuote: vi.fn(),
      getBalances: vi.fn(),
      sleep: vi.fn(),
    };
    const engine = new AutomationEngine(store, adapter);

    const result = await engine.processQuote({
      market: {
        marketSlug: "partial-fill",
        eventSlug: "partial-fill-event",
        eventTitle: "Partial fill event",
        marketTitle: "Partial fill market",
        longOutcome: "Yes",
        shortOutcome: "No",
        minimumTradeQty: 0.01,
        priceTickSize: 0.01,
        isLive: true,
        isOpen: true,
      },
      quote: { bestBid: 0.94, bestAsk: 0.95 },
      balances: { currentBalance: 250, buyingPower: 100 },
    });

    expect(result).toBe("filled");
    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(store.getAttempt("partial-fill")).toMatchObject({
      status: "filled",
      orderId: "partial-order",
      attempts: 1,
    });

    store.close();
  });
});
