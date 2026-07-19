import { describe, expect, it } from "vitest";
import { calculateDashboard } from "@/lib/calculate-dashboard";
import { getMockDashboard } from "@/lib/mock-data";

describe("calculateDashboard", () => {
  it("builds a market-level win/loss record and cash-flow summary", () => {
    const dashboard = getMockDashboard();

    expect(dashboard.summary).toMatchObject({
      wins: 3,
      losses: 2,
      pushes: 1,
      closedMarkets: 6,
      openMarkets: 2,
      winRate: 60,
      deposits: 1000,
      withdrawals: 180,
      netFunding: 820,
      rewardsAndRebates: 12.7,
      netAccountInflows: 832.7,
      tradingVolume: 87,
    });
    expect(dashboard.summary.realizedPnl).toBeCloseTo(83.3);
    expect(dashboard.summary.estimatedOpenPnl).toBeCloseTo(16.2);
    expect(dashboard.summary.estimatedTotalPnl).toBeCloseTo(99.5);
    expect(dashboard.summary.openPositionValue).toBeCloseTo(103.2);
  });

  it("does not double count an advance against a pending deposit", () => {
    const dashboard = calculateDashboard({
      mode: "live",
      positions: { positions: {}, eof: true },
      balances: { balances: [] },
      activities: {
        eof: true,
        activities: [
          {
            type: "ACTIVITY_TYPE_ACCOUNT_ADVANCED_DEPOSIT",
            accountBalanceChange: {
              transactionId: "advance",
              status: "COMPLETED",
              amount: { value: "100", currency: "USD" },
            },
          },
          {
            type: "ACTIVITY_TYPE_ACCOUNT_DEPOSIT",
            accountBalanceChange: {
              transactionId: "deposit",
              status: "COMPLETED",
              amount: { value: "250", currency: "USD" },
            },
          },
        ],
      },
      generatedAt: "2026-07-18T00:00:00Z",
    });

    expect(dashboard.summary.deposits).toBe(250);
    expect(dashboard.summary.netFunding).toBe(250);
  });

  it("recovers a closed result from settlement activity when positions omit it", () => {
    const dashboard = calculateDashboard({
      mode: "live",
      positions: { positions: {}, eof: true },
      balances: { balances: [] },
      activities: {
        eof: true,
        activities: [
          {
            type: "ACTIVITY_TYPE_POSITION_RESOLUTION",
            positionResolution: {
              marketSlug: "resolved-market",
              updateTime: "2026-06-01T12:00:00Z",
              afterPosition: {
                netPositionDecimal: "0",
                qtyBoughtDecimal: "25",
                qtySoldDecimal: "25",
                realized: { value: "14.75", currency: "USD" },
                expired: true,
                marketMetadata: {
                  title: "Resolved market",
                  outcome: "YES",
                },
              },
            },
          },
        ],
      },
      generatedAt: "2026-07-18T00:00:00Z",
    });

    expect(dashboard.summary.wins).toBe(1);
    expect(dashboard.summary.realizedPnl).toBe(14.75);
    expect(dashboard.positions[0]).toMatchObject({
      marketSlug: "resolved-market",
      result: "win",
      realizedPnl: 14.75,
    });
  });

  it("counts a zero-net live market as closed after the user exits", () => {
    const dashboard = calculateDashboard({
      mode: "live",
      positions: {
        eof: true,
        positions: {
          "closed-before-expiry": {
            netPositionDecimal: "0",
            qtyBoughtDecimal: "10",
            qtySoldDecimal: "10",
            realized: { value: "-2.50", currency: "USD" },
            expired: false,
          },
        },
      },
      activities: { activities: [], eof: true },
      balances: { balances: [] },
      generatedAt: "2026-07-18T00:00:00Z",
    });

    expect(dashboard.summary.losses).toBe(1);
    expect(dashboard.summary.openMarkets).toBe(0);
  });
});
