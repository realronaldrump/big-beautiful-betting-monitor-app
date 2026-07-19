import { describe, expect, it } from "vitest";
import type { PnlPoint, PositionRow } from "@/lib/dashboard-types";
import {
  computeEdge,
  computeForm,
  computeOpenBook,
  computeStreak,
  entryPrice,
  impliedPrice,
} from "@/lib/insights";

function point(delta: number, cumulative = 0): PnlPoint {
  return {
    marketSlug: `market-${delta}-${Math.random()}`,
    label: "Market",
    occurredAt: "2026-07-01T00:00:00Z",
    delta,
    cumulative,
  };
}

function position(overrides: Partial<PositionRow>): PositionRow {
  return {
    marketSlug: "slug",
    title: "Title",
    outcome: "YES",
    result: "open",
    isOpen: true,
    quantity: 0,
    costBasis: 0,
    marketValue: 0,
    realizedPnl: 0,
    openPnl: 0,
    updatedAt: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

describe("computeStreak", () => {
  it("returns none for an empty history", () => {
    expect(computeStreak([])).toEqual({ kind: "none", length: 0 });
  });

  it("counts consecutive wins from the latest result", () => {
    const history = [point(-5), point(10), point(4)];
    expect(computeStreak(history)).toEqual({ kind: "win", length: 2 });
  });

  it("counts losses and stops at the first opposite result", () => {
    const history = [point(8), point(-2), point(-6)];
    expect(computeStreak(history)).toEqual({ kind: "loss", length: 2 });
  });

  it("skips pushes without breaking the streak", () => {
    const history = [point(5), point(0), point(3)];
    expect(computeStreak(history)).toEqual({ kind: "win", length: 2 });
  });
});

describe("computeForm", () => {
  it("maps recent deltas to results, oldest first", () => {
    const history = [point(5), point(-1), point(0)];
    expect(computeForm(history)).toEqual(["win", "loss", "push"]);
  });

  it("limits to the requested window", () => {
    const history = Array.from({ length: 14 }, () => point(1));
    expect(computeForm(history, 10)).toHaveLength(10);
  });
});

describe("computeEdge", () => {
  it("computes profit factor, averages, and extremes", () => {
    const history = [point(30), point(-10), point(10), point(-10)];
    const edge = computeEdge(history);
    expect(edge.grossWins).toBe(40);
    expect(edge.grossLosses).toBe(20);
    expect(edge.profitFactor).toBe(2);
    expect(edge.averageWin).toBe(20);
    expect(edge.averageLoss).toBe(10);
    expect(edge.edgePerBet).toBe(5);
    expect(edge.bestPoint?.delta).toBe(30);
    expect(edge.worstPoint?.delta).toBe(-10);
  });

  it("returns a null profit factor when nothing has been lost", () => {
    expect(computeEdge([point(12)]).profitFactor).toBeNull();
  });
});

describe("computeOpenBook", () => {
  it("totals only open positions and derives the max payout", () => {
    const positions = [
      position({ isOpen: true, quantity: 48, costBasis: 28.8, marketValue: 37.92 }),
      position({ isOpen: true, quantity: 75, costBasis: 58.2, marketValue: 65.28 }),
      position({ isOpen: false, quantity: 0, costBasis: 0, marketValue: 0 }),
    ];
    const book = computeOpenBook(positions);
    expect(book.atRisk).toBeCloseTo(87);
    expect(book.liveValue).toBeCloseTo(103.2);
    expect(book.contracts).toBe(123);
    expect(book.maxPayout).toBe(123);
    expect(book.maxProfit).toBeCloseTo(36);
  });
});

describe("prices", () => {
  it("derives implied and entry prices per contract", () => {
    const open = position({ quantity: 48, costBasis: 28.8, marketValue: 37.92 });
    expect(impliedPrice(open)).toBeCloseTo(0.79);
    expect(entryPrice(open)).toBeCloseTo(0.6);
  });

  it("returns null when there are no contracts", () => {
    const flat = position({ quantity: 0 });
    expect(impliedPrice(flat)).toBeNull();
    expect(entryPrice(flat)).toBeNull();
  });
});
