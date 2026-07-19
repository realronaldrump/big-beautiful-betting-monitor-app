import { describe, expect, it } from "vitest";
import type { PnlPoint } from "@/lib/dashboard-types";
import { computePnlRange } from "@/lib/pnl-range";

function point(
  occurredAt: string,
  delta: number,
  cumulative: number,
): PnlPoint {
  return {
    marketSlug: occurredAt,
    label: "Market",
    occurredAt,
    delta,
    cumulative,
  };
}

describe("computePnlRange", () => {
  const asOf = "2026-07-18T12:00:00Z";
  const history = [
    point("2026-07-10T12:00:00Z", 12, 12),
    point("2026-07-18T10:00:00Z", -5, 7),
    point("2026-07-18T11:30:00Z", 9, 16),
  ];

  it("totals and rebases finished bets in the selected range", () => {
    const selected = computePnlRange(history, "24h", asOf);

    expect(selected.realizedPnl).toBe(4);
    expect(selected.history.map((entry) => entry.cumulative)).toEqual([-5, 4]);
  });

  it("keeps the complete all-time total", () => {
    const selected = computePnlRange(history, "all", asOf);

    expect(selected.realizedPnl).toBe(16);
    expect(selected.history.map((entry) => entry.cumulative)).toEqual([12, 7, 16]);
  });

  it("returns a zero total when no finished bets fall in the range", () => {
    expect(
      computePnlRange(history, "1h", "2026-07-18T13:00:00Z"),
    ).toEqual({
      history: [],
      realizedPnl: 0,
    });
  });
});
