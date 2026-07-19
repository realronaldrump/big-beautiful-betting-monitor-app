import type { PnlPoint } from "@/lib/dashboard-types";

export type ChartRange =
  | "15m"
  | "1h"
  | "6h"
  | "24h"
  | "7d"
  | "30d"
  | "all";

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

/** Selects a trailing date window, anchored to the newest settled market. */
export function selectChartRange(
  points: PnlPoint[],
  range: ChartRange,
): SelectedChartRange {
  if (!points.length || range === "all") {
    return { points, startingCumulative: 0 };
  }

  const latestTime = Date.parse(points[points.length - 1].occurredAt);
  if (!Number.isFinite(latestTime)) {
    return { points, startingCumulative: 0 };
  }

  const cutoff = latestTime - RANGE_MS[range];
  const startIndex = points.findIndex(
    (point) => Date.parse(point.occurredAt) >= cutoff,
  );

  if (startIndex <= 0) {
    return { points, startingCumulative: 0 };
  }

  return {
    points: points.slice(startIndex),
    startingCumulative: points[startIndex - 1].cumulative,
  };
}
