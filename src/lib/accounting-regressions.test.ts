import { expect, it } from "vitest";
import { calculateDashboard } from "./calculate-dashboard";
import type { RawActivity } from "./polymarket-types";
function dashboard(activities: RawActivity[]) {
  return calculateDashboard({
    mode: "live",
    positions: { positions: {} },
    activities: { activities },
    balances: { balances: [] },
  });
}
it("uses the cost and outcome price of the user's NO trade", () => {
  const trade = {
    id: "no-trade",
    marketSlug: "m",
    price: { value: ".025" },
    qtyDecimal: "1.02",
    cost: { value: ".9945" },
    isAggressor: true,
    aggressorExecution: { order: { intent: "ORDER_INTENT_BUY_SHORT" } },
  };
  const d = dashboard([{ type: "ACTIVITY_TYPE_TRADE", trade }]);
  expect(d.summary.tradingVolume).toBeCloseTo(0.9945);
  expect(d.activities[0].detail).toContain("$0.98");
});
it("retains settled outcomes and subtracts fees from the realized result", () => {
  const before = {
    netPositionDecimal: "-12.26",
    qtySoldDecimal: "12.26",
    cost: { value: "10.0021" },
    baseCost: { value: "9.8693" },
    fees: { value: ".1328" },
    marketMetadata: { outcome: "Bears" },
  };
  const after = {
    netPositionDecimal: "0",
    qtyBoughtDecimal: "12.26",
    qtySoldDecimal: "12.26",
    realized: { value: "2.3907" },
    marketMetadata: { outcome: "None" },
  };
  const d = dashboard([
    {
      type: "ACTIVITY_TYPE_POSITION_RESOLUTION",
      positionResolution: {
        marketSlug: "m",
        beforePosition: before,
        afterPosition: after,
      },
    },
  ]);
  expect(d.positions[0].outcome).toBe("Bears");
  expect(d.summary.realizedPnl).toBeCloseTo(2.2579);
});
it("keeps realized profit on partial exits in the total and time history", () => {
  const buy = {
    id: "b",
    marketSlug: "m",
    qtyDecimal: "10",
    price: { value: ".5" },
    cost: { value: "5" },
    createTime: "2026-09-20T12:00:00Z",
    isAggressor: true,
    aggressorExecution: { order: { intent: "ORDER_INTENT_BUY_LONG" } },
  };
  const sell = {
    id: "s",
    marketSlug: "m",
    qtyDecimal: "5",
    price: { value: ".8" },
    cost: { value: "4" },
    createTime: "2026-09-21T12:00:00Z",
    isAggressor: true,
    aggressorExecution: { order: { intent: "ORDER_INTENT_SELL_LONG" } },
  };
  const result = calculateDashboard({
    mode: "live",
    positions: {
      positions: {
        m: {
          netPositionDecimal: "5",
          qtyBoughtDecimal: "10",
          qtySoldDecimal: "5",
          cost: { value: "2.5" },
          cashValue: { value: "3" },
          realized: { value: "1.5" },
        },
      },
    },
    activities: { activities: [{ trade: buy }, { trade: sell }] },
    balances: { balances: [] },
  });
  expect(result.summary.realizedPnl).toBe(1.5);
  expect(result.summary.estimatedTotalPnl).toBe(2);
  expect(result.realizedHistory?.at(-1)?.cumulative).toBe(1.5);
});
it("recovers a fully exited market omitted by the positions API", () => {
  const executions = [
    {
      id: "b",
      qtyDecimal: "10",
      price: { value: ".5" },
      cost: { value: "5" },
      isAggressor: true,
      aggressorExecution: { order: { intent: "ORDER_INTENT_BUY_LONG" } },
      createTime: "2026-09-20T12:00:00Z",
    },
    {
      id: "s",
      qtyDecimal: "10",
      price: { value: ".8" },
      cost: { value: "8" },
      isAggressor: true,
      aggressorExecution: { order: { intent: "ORDER_INTENT_SELL_LONG" } },
      createTime: "2026-09-21T12:00:00Z",
    },
  ];
  const result = dashboard(
    executions.map((trade) => ({ trade: { ...trade, marketSlug: "m" } })),
  );
  expect(result.positions).toHaveLength(1);
  expect(result.positions[0]).toMatchObject({
    isOpen: false,
    result: "win",
    amountBet: 5,
    realizedPnl: 3,
  });
});
it("excludes synthetic-short collateral from displayed cash", () => {
  const result = calculateDashboard({
    mode: "live",
    positions: { positions: {} },
    activities: { activities: [] },
    balances: {
      balances: [
        {
          currency: "USD",
          currentBalance: 52,
          marginRequirement: 10,
          buyingPower: 42,
          displayedCash: 42,
        },
      ],
    },
  });
  expect(result.summary.currentBalance).toBe(42);
});
