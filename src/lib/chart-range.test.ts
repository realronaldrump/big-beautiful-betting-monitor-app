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
    expect(selectChartRange(points, "all", "2026-07-15T12:00:00Z")).toEqual({
      points,
      startingCumulative: 0,
    });
  });

  it("selects a trailing seven-day window ending at the snapshot", () => {
    const selected = selectChartRange(points, "7d", "2026-07-15T12:00:00Z");

    expect(selected.points.map((entry) => entry.marketSlug)).toEqual([
      "market-8",
      "market-14",
      "market-15",
    ]);
    expect(selected.startingCumulative).toBe(10);
  });

  it("keeps the preceding cumulative value as the range baseline", () => {
    const selected = selectChartRange(points, "24h", "2026-07-15T12:00:00Z");

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
      selectChartRange(intraday, "15m", "2026-07-15T12:00:00Z").points.map(
        (entry) => entry.cumulative,
      ),
    ).toEqual([30, 40]);
    expect(
      selectChartRange(intraday, "1h", "2026-07-15T12:00:00Z").points.map(
        (entry) => entry.cumulative,
      ),
    ).toEqual([20, 30, 40]);
    expect(
      selectChartRange(intraday, "15m", "2026-07-15T12:00:00Z")
        .startingCumulative,
    ).toBe(20);
  });

  it("excludes invalid dates from a trailing window", () => {
    const invalid = [{ ...point(1, 10), occurredAt: "unknown" }];

    expect(selectChartRange(invalid, "7d", "2026-07-15T12:00:00Z")).toEqual({
      points: [],
      startingCumulative: 0,
    });
  });
});

it("does not show yesterday in the last hour", () => {
  expect(
    selectChartRange([point(15, 10)], "1h", "2026-07-16T12:00:00Z").points,
  ).toEqual([]);
});
