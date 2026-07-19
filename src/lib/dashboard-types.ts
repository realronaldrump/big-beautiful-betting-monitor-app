export type DataMode = "live" | "demo";
export type BetResult = "win" | "loss" | "push" | "open";
export type ActivityKind = "trade" | "settlement" | "cash" | "other";

export interface PositionRow {
  marketSlug: string;
  title: string;
  outcome: string;
  result: BetResult;
  isOpen: boolean;
  quantity: number;
  costBasis: number;
  marketValue: number;
  realizedPnl: number;
  openPnl: number;
  updatedAt: string;
}

export interface ActivityRow {
  id: string;
  kind: ActivityKind;
  type: string;
  label: string;
  detail: string;
  amount: number | null;
  realizedPnl: number | null;
  status: string;
  occurredAt: string;
}

export interface PnlPoint {
  marketSlug: string;
  label: string;
  occurredAt: string;
  delta: number;
  cumulative: number;
}

export interface DashboardSummary {
  wins: number;
  losses: number;
  pushes: number;
  winRate: number;
  closedMarkets: number;
  openMarkets: number;
  realizedPnl: number;
  estimatedOpenPnl: number;
  estimatedTotalPnl: number;
  openPositionValue: number;
  tradingVolume: number;
  currentBalance: number;
  buyingPower: number;
  unsettledFunds: number;
  deposits: number;
  withdrawals: number;
  netFunding: number;
  rewardsAndRebates: number;
  otherTransfers: number;
  netAccountInflows: number;
}

export interface DashboardSnapshot {
  mode: DataMode;
  setupRequired: boolean;
  generatedAt: string;
  currency: string;
  summary: DashboardSummary;
  positions: PositionRow[];
  activities: ActivityRow[];
  pnlHistory: PnlPoint[];
  notes: string[];
}
