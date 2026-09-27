import { afterEach, expect, it, vi } from "vitest";
import {
  AutomationEngine,
  type TradingAdapter,
  type QuoteState,
} from "./engine";
import { AutomationStore } from "./store";
const stores: AutomationStore[] = [];
afterEach(() => {
  stores.splice(0).forEach((s) => s.close());
  vi.useRealTimers();
});
function fixture() {
  const store = new AutomationStore(":memory:");
  stores.push(store);
  store.updateConfig({
    enabled: true,
    balanceFloor: 100,
    triggerPrice: 0.95,
    executionCap: 0.96,
  });
  const state: QuoteState = {
    market: {
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
    },
    quote: { bestAsk: 0.95 },
    balances: { currentBalance: 250, buyingPower: 250 },
  };
  const sent = vi.fn().mockResolvedValue({ id: "accepted", executions: [] });
  const adapter: TradingAdapter = {
    previewOrder: vi.fn().mockResolvedValue({}),
    createOrder: async (order, check) => {
      check();
      return sent(order);
    },
    getQuote: vi.fn().mockRejectedValue(new Error("Must never poll BBO")),
    getBalances: vi.fn(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
  return {
    store,
    state,
    sent,
    adapter,
    engine: new AutomationEngine(store, adapter),
  };
}
it("reserves fees and refuses a fill that would breach the cash floor", async () => {
  const f = fixture();
  f.store.updateConfig({
    enabled: true,
    balanceFloor: 100,
    triggerPrice: 0.5,
    executionCap: 0.5,
  });
  f.state.quote = { bestAsk: 0.5 };
  f.state.balances = { currentBalance: 101, buyingPower: 101 };
  await f.engine.processQuote(f.state);
  expect(f.sent).not.toHaveBeenCalled();
  expect(f.store.getAttempt("m")).toMatchObject({
    status: "retryable",
    attempts: 0,
  });
});
it("considers a preview commission greater than the standard estimate", async () => {
  const f = fixture();
  f.state.balances = { currentBalance: 101.1, buyingPower: 101.1 };
  vi.mocked(f.adapter.previewOrder).mockResolvedValue({
    order: { commissionNotionalTotalCollected: { value: ".25" } },
  });
  await f.engine.processQuote(f.state);
  expect(f.sent).not.toHaveBeenCalled();
});
it("preserves definitive rejection semantics without retry-time REST reads", async () => {
  vi.useFakeTimers();
  const f = fixture();
  f.sent.mockResolvedValueOnce({
    id: "rejected",
    executions: [
      {
        type: "EXECUTION_TYPE_REJECTED",
        order: { state: "ORDER_STATE_REJECTED" },
      },
    ],
  });
  const pending = f.engine.processQuote({
    ...f.state,
    readCurrent: () => f.state,
  });
  await vi.advanceTimersByTimeAsync(1000);
  expect(await pending).toBe("submitted");
  expect(f.sent).toHaveBeenCalledTimes(2);
  expect(f.adapter.getQuote).not.toHaveBeenCalled();
  expect(f.adapter.getBalances).not.toHaveBeenCalled();
});
it("interrupts a four-second retry within 250ms when Off is saved", async () => {
  vi.useFakeTimers();
  const f = fixture();
  f.sent.mockResolvedValue({
    id: "rejected",
    executions: [
      {
        type: "EXECUTION_TYPE_REJECTED",
        order: { state: "ORDER_STATE_REJECTED" },
      },
    ],
  });
  let done = false;
  const pending = f.engine.processQuote(f.state).then((r) => {
    done = true;
    return r;
  });
  await vi.advanceTimersByTimeAsync(3000);
  expect(f.sent).toHaveBeenCalledTimes(3);
  f.store.setEnabled(false);
  await vi.advanceTimersByTimeAsync(250);
  expect(done).toBe(true);
  expect(await pending).toBe("ignored");
  expect(f.sent).toHaveBeenCalledTimes(3);
});
it("handles request timeouts as ambiguous, never definite retryable rejects", async () => {
  const f = fixture();
  f.sent.mockRejectedValue(
    Object.assign(new Error("timeout"), { status: 408 }),
  );
  expect(await f.engine.processQuote(f.state)).toBe("ambiguous");
  expect(f.sent).toHaveBeenCalledTimes(1);
  expect(f.store.uncertainCashReserve("another")).toBeGreaterThan(1);
});
it("recovers preview-only interruptions and flags unknown legacy submissions", async () => {
  const f = fixture();
  f.store.beginAttempt({
    marketSlug: "preview",
    eventSlug: "e",
    title: "P",
    outcome: "Yes",
    triggerPrice: 0.95,
  });
  const submitted = f.store.beginAttempt({
    marketSlug: "unknown",
    eventSlug: "e",
    title: "U",
    outcome: "Yes",
    triggerPrice: 0.95,
  })!;
  f.store.markDispatching("unknown", submitted.attemptId);
  await f.engine.reconcileInterruptedAttempts();
  expect(f.store.getAttempt("preview")).toMatchObject({
    status: "retryable",
    attempts: 0,
  });
  expect(f.store.getAttempt("unknown")).toMatchObject({ status: "ambiguous" });
});
it("reconciles a known exchange order after restart", async () => {
  const f = fixture();
  f.store.beginAttempt({
    marketSlug: "m",
    eventSlug: "e",
    title: "M",
    outcome: "Yes",
    triggerPrice: 0.95,
  });
  f.store.markSubmitted("m", "known");
  f.adapter.getOrder = vi
    .fn()
    .mockResolvedValue({
      order: {
        marketSlug: "m",
        id: "known",
        state: "ORDER_STATE_FILLED",
        cumQuantity: 1,
      },
    });
  await f.engine.reconcileInterruptedAttempts();
  expect(f.store.getAttempt("m")?.status).toBe("filled");
  expect(f.store.uncertainCashReserve("other")).toBe(0);
});
