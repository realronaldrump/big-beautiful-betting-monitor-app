import type { PnlPoint } from "@/lib/dashboard-types";
import {
  selectRecordRange,
  type RecordRange,
} from "@/lib/record-range";

export interface PnlRangeSummary {
  history: PnlPoint[];
  realizedPnl: number;
}

/** Selects finished bets in a range and rebases their cumulative P&L to zero. */
export function computePnlRange(
  history: PnlPoint[],
  range: RecordRange,
  asOf: string,
): PnlRangeSummary {
  let realizedPnl = 0;
  const rangedHistory = selectRecordRange(history, range, asOf).map((point) => {
    realizedPnl += point.delta;
    return { ...point, cumulative: realizedPnl };
  });

  return { history: rangedHistory, realizedPnl };
}
