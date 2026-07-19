import type { PnlPoint } from "@/lib/dashboard-types";

export type RecordRange = "1h" | "24h" | "7d" | "30d" | "all";

export const RECORD_RANGE_OPTIONS: ReadonlyArray<{
  value: RecordRange;
  label: string;
}> = [
  { value: "1h", label: "1H" },
  { value: "24h", label: "24H" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "all", label: "All" },
];

export interface RecordStats {
  wins: number;
  losses: number;
  pushes: number;
  winRate: number;
  settledMarkets: number;
}

const PUSH_TOLERANCE = 0.005;

const RANGE_MS: Record<Exclude<RecordRange, "all">, number> = {
  "1h": 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

/** Selects settlements in a trailing window ending at the snapshot time. */
export function selectRecordRange(
  points: PnlPoint[],
  range: RecordRange,
  asOf: string,
): PnlPoint[] {
  if (range === "all") return points;

  const endTime = Date.parse(asOf);
  if (!Number.isFinite(endTime)) return points;

  const cutoff = endTime - RANGE_MS[range];
  return points.filter((point) => {
    const occurredAt = Date.parse(point.occurredAt);
    return Number.isFinite(occurredAt) && occurredAt >= cutoff && occurredAt <= endTime;
  });
}

export function computeRecordStats(points: PnlPoint[]): RecordStats {
  let wins = 0;
  let losses = 0;
  let pushes = 0;

  for (const point of points) {
    if (point.delta > PUSH_TOLERANCE) wins += 1;
    else if (point.delta < -PUSH_TOLERANCE) losses += 1;
    else pushes += 1;
  }

  const decisiveMarkets = wins + losses;
  return {
    wins,
    losses,
    pushes,
    winRate: decisiveMarkets ? (wins / decisiveMarkets) * 100 : 0,
    settledMarkets: points.length,
  };
}
