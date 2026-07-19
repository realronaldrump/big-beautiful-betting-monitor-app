import { describe, expect, it } from "vitest";
import type { PnlPoint } from "@/lib/dashboard-types";
import {
  computeRecordStats,
  selectRecordRange,
} from "@/lib/record-range";

function point(occurredAt: string, delta: number): PnlPoint {
  return {
    marketSlug: `${occurredAt}-${delta}`,
    label: "Market",
    occurredAt,
    delta,
    cumulative: delta,
  };
}

describe("selectRecordRange", () => {
  const asOf = "2026-07-18T12:00:00Z";
  const points = [
    point("2026-06-01T12:00:00Z", 10),
    point("2026-07-11T12:00:00Z", -5),
    point("2026-07-18T11:00:00Z", 4),
    point("2026-07-18T11:45:00Z", 0),
  ];

  it("returns the complete history for all time", () => {
    expect(selectRecordRange(points, "all", asOf)).toEqual(points);
  });

  it("includes settlements on the last-hour boundary", () => {
    expect(selectRecordRange(points, "1h", asOf)).toEqual(points.slice(2));
  });

  it("uses the snapshot time instead of the newest settlement as its anchor", () => {
    expect(
      selectRecordRange(
        [point("2026-07-18T10:00:00Z", 8)],
        "1h",
        asOf,
      ),
    ).toEqual([]);
  });

  it("falls back to all history when the snapshot date is invalid", () => {
    expect(selectRecordRange(points, "7d", "unknown")).toEqual(points);
  });
});

describe("computeRecordStats", () => {
  it("counts outcomes and excludes pushes from win rate", () => {
    expect(
      computeRecordStats([
        point("2026-07-18T09:00:00Z", 12),
        point("2026-07-18T10:00:00Z", -3),
        point("2026-07-18T11:00:00Z", 0),
      ]),
    ).toEqual({
      wins: 1,
      losses: 1,
      pushes: 1,
      winRate: 50,
      settledMarkets: 3,
    });
  });
});
