import type {
  BetResult,
  DashboardSummary,
  PnlPoint,
  PositionRow,
} from "@/lib/dashboard-types";

const PUSH_TOLERANCE = 0.005;

export interface StreakInfo {
  kind: "win" | "loss" | "none";
  length: number;
}

export interface EdgeStats {
  /** Gross wins divided by gross losses; null when there are no losses yet. */
  profitFactor: number | null;
  grossWins: number;
  grossLosses: number;
  averageWin: number;
  averageLoss: number;
  edgePerBet: number;
  bestPoint: PnlPoint | null;
  worstPoint: PnlPoint | null;
}

export interface OpenBookStats {
  /** Total cost basis currently locked in open positions. */
  atRisk: number;
  /** Current market value of open positions. */
  liveValue: number;
  /** Contracts held across open positions; each pays $1 on a win. */
  contracts: number;
  /** What the book pays out if every open bet settles in your favor. */
  maxPayout: number;
  /** Max payout minus what it cost to build the book. */
  maxProfit: number;
}

function pointResult(delta: number): "win" | "loss" | "push" {
  if (delta > PUSH_TOLERANCE) return "win";
  if (delta < -PUSH_TOLERANCE) return "loss";
  return "push";
}

/** Current run of consecutive wins or losses; pushes neither extend nor break it. */
export function computeStreak(history: PnlPoint[]): StreakInfo {
  let kind: StreakInfo["kind"] = "none";
  let length = 0;

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const result = pointResult(history[index].delta);
    if (result === "push") continue;
    if (kind === "none") {
      kind = result;
      length = 1;
    } else if (result === kind) {
      length += 1;
    } else {
      break;
    }
  }

  return { kind, length };
}

/** Most recent `limit` settled results, oldest first. */
export function computeForm(history: PnlPoint[], limit = 10): BetResult[] {
  return history.slice(-limit).map((point) => pointResult(point.delta));
}

export function computeEdge(history: PnlPoint[]): EdgeStats {
  let grossWins = 0;
  let grossLosses = 0;
  let wins = 0;
  let losses = 0;
  let bestPoint: PnlPoint | null = null;
  let worstPoint: PnlPoint | null = null;

  for (const point of history) {
    const result = pointResult(point.delta);
    if (result === "win") {
      grossWins += point.delta;
      wins += 1;
    } else if (result === "loss") {
      grossLosses += Math.abs(point.delta);
      losses += 1;
    }
    if (!bestPoint || point.delta > bestPoint.delta) bestPoint = point;
    if (!worstPoint || point.delta < worstPoint.delta) worstPoint = point;
  }

  return {
    profitFactor: grossLosses > 0 ? grossWins / grossLosses : null,
    grossWins,
    grossLosses,
    averageWin: wins ? grossWins / wins : 0,
    averageLoss: losses ? grossLosses / losses : 0,
    edgePerBet: history.length
      ? history.reduce((total, point) => total + point.delta, 0) / history.length
      : 0,
    bestPoint,
    worstPoint,
  };
}

export function computeOpenBook(positions: PositionRow[]): OpenBookStats {
  const open = positions.filter((position) => position.isOpen);
  const atRisk = open.reduce((total, position) => total + position.costBasis, 0);
  const liveValue = open.reduce(
    (total, position) => total + position.marketValue,
    0,
  );
  const contracts = open.reduce(
    (total, position) => total + Math.abs(position.quantity),
    0,
  );

  return {
    atRisk,
    liveValue,
    contracts,
    maxPayout: contracts,
    maxProfit: contracts - atRisk,
  };
}

/** Current price per contract implied by market value, in dollars (0–1). */
export function impliedPrice(position: PositionRow): number | null {
  const contracts = Math.abs(position.quantity);
  if (contracts < 1e-9) return null;
  return position.marketValue / contracts;
}

/** Average entry price per contract, in dollars (0–1). */
export function entryPrice(position: PositionRow): number | null {
  const contracts = Math.abs(position.quantity);
  if (contracts < 1e-9) return null;
  return position.costBasis / contracts;
}

/** Total P&L as a percentage of money deposited; null when nothing deposited. */
export function returnOnDeposits(summary: DashboardSummary): number | null {
  if (summary.deposits <= 0) return null;
  return (summary.estimatedTotalPnl / summary.deposits) * 100;
}
