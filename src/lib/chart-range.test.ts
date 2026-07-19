import { describe, expect, it } from "vitest";
import type { PnlPoint } from "@/lib/dashboard-types";
import { selectChartRange } from "@/lib/chart-range";

function point(day: number, cumulative: number): PnlPoint {
  return {
    marketSlug: `market-${day}`,
    label: `Market ${day}`,
    occurredAt: `2026-07-${String(day).padStart(2, "0")}T12:00:00Z`,
    delta: 10,
    cumulative,
  };
}

function timedPoint(time: string, cumulative: number): PnlPoint {
  return {
    marketSlug: `market-${time}`,
    label: `Market ${time}`,
    occurredAt: `2026-07-15T${time}:00Z`,
    delta: 10,
    cumulative,
  };
}

describe("selectChartRange", () => {
  const points = [point(1, 10), point(8, 20), point(14, 30), point(15, 40)];

  it("returns the complete history for all time", () => {
    expect(selectChartRange(points, "all")).toEqual({
      points,
      startingCumulative: 0,
    });
  });

  it("selects a trailing seven-day window from the newest result", () => {
    const selected = selectChartRange(points, "7d");

    expect(selected.points.map((entry) => entry.marketSlug)).toEqual([
      "market-8",
      "market-14",
      "market-15",
    ]);
    expect(selected.startingCumulative).toBe(10);
  });

  it("keeps the preceding cumulative value as the range baseline", () => {
    const selected = selectChartRange(points, "24h");

    expect(selected.points.map((entry) => entry.marketSlug)).toEqual([
      "market-14",
      "market-15",
    ]);
    expect(selected.startingCumulative).toBe(20);
  });

  it("supports minute and hour windows", () => {
    const intraday = [
      timedPoint("10:00", 10),
      timedPoint("11:30", 20),
      timedPoint("11:50", 30),
      timedPoint("12:00", 40),
    ];

    expect(
      selectChartRange(intraday, "15m").points.map((entry) => entry.cumulative),
    ).toEqual([30, 40]);
    expect(
      selectChartRange(intraday, "1h").points.map((entry) => entry.cumulative),
    ).toEqual([20, 30, 40]);
    expect(selectChartRange(intraday, "15m").startingCumulative).toBe(20);
  });

  it("falls back to all history when dates are invalid", () => {
    const invalid = [{ ...point(1, 10), occurredAt: "unknown" }];

    expect(selectChartRange(invalid, "7d")).toEqual({
      points: invalid,
      startingCumulative: 0,
    });
  });
});
