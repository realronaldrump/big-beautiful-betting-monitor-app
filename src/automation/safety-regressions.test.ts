import { afterEach, expect, it, vi } from "vitest";
import { AutomationStore } from "./store";
import {
  AutomationEngine,
  type TradingAdapter,
  type TrackedMarket,
} from "./engine";
const stores: AutomationStore[] = [];
afterEach(() => {
  stores.splice(0).forEach((store) => store.close());
});
function store() {
  const value = new AutomationStore(":memory:");
  stores.push(value);
  value.updateConfig({
    enabled: true,
    balanceFloor: 100,
    triggerPrice: 0.95,
    executionCap: 0.96,
  });
  return value;
}
const market: TrackedMarket = {
  marketSlug: "market",
  eventSlug: "event",
  eventTitle: "Event",
  marketTitle: "Market",
  longOutcome: "Yes",
  shortOutcome: "No",
  minimumTradeQty: 0.01,
  priceTickSize: 0.01,
  isLive: true,
  isOpen: true,
};
const attempt = {
  marketSlug: "market",
  eventSlug: "event",
  title: "Market",
  outcome: "Yes",
  triggerPrice: 0.95,
};
it("never unlocks a filled market on a later rejection", () => {
  const s = store();
  s.beginAttempt(attempt);
  s.markFilled("market", "filled");
  expect(s.markExplicitRejection("market", "late rejection")).toBe(false);
  expect(s.getAttempt("market")?.status).toBe("filled");
  expect(s.beginAttempt(attempt)).toBeNull();
});
it("never downgrades a fill to a REST acknowledgement", () => {
  const s = store();
  s.beginAttempt(attempt);
  s.markFilled("market", "filled");
  s.markSubmitted("market", "filled");
  expect(s.getAttempt("market")?.status).toBe("filled");
});
it("records the actual side when a retry changes outcome", () => {
  const s = store();
  s.beginAttempt(attempt);
  s.markExplicitRejection("market", "rejected");
  s.beginAttempt({ ...attempt, outcome: "No" });
  expect(s.getAttempt("market")?.outcome).toBe("No");
});
it("does not exhaust a market on a temporary preview outage", async () => {
  const s = store();
  const adapter: TradingAdapter = {
    previewOrder: vi.fn().mockRejectedValue(new Error("network outage")),
    createOrder: vi.fn(),
    getQuote: vi.fn().mockResolvedValue({ bestAsk: 0.95 }),
    getBalances: vi
      .fn()
      .mockResolvedValue({ currentBalance: 250, buyingPower: 250 }),
    sleep: vi.fn().mockResolvedValue(undefined),
  };
  await new AutomationEngine(s, adapter)
    .processQuote({
      market,
      quote: { bestAsk: 0.95 },
      balances: { currentBalance: 250, buyingPower: 250 },
    })
    .catch(() => undefined);
  expect(s.getAttempt("market")).toMatchObject({
    status: "retryable",
    attempts: 0,
  });
  expect(adapter.createOrder).not.toHaveBeenCalled();
});
