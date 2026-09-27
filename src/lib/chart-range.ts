import type { PnlPoint } from "@/lib/dashboard-types";

export type ChartRange = "15m" | "1h" | "6h" | "24h" | "7d" | "30d" | "all";

interface SelectedChartRange {
  points: PnlPoint[];
  startingCumulative: number;
}

const RANGE_MS: Record<Exclude<ChartRange, "all">, number> = {
  "15m": 15 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

/** Selects a trailing date window, ending at the account snapshot time. */
export function selectChartRange(
  points: PnlPoint[],
  range: ChartRange,
  asOf: string,
): SelectedChartRange {
  if (!points.length || range === "all") {
    return { points, startingCumulative: 0 };
  }

  const endTime = Date.parse(asOf);
  if (!Number.isFinite(endTime)) return { points: [], startingCumulative: 0 };
  const cutoff = endTime - RANGE_MS[range];
  const selected = points.filter((point) => {
    const time = Date.parse(point.occurredAt);
    return time >= cutoff && time <= endTime;
  });
  const preceding = points
    .filter((point) => Date.parse(point.occurredAt) < cutoff)
    .at(-1);
  return { points: selected, startingCumulative: preceding?.cumulative || 0 };
}
