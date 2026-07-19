export interface RawAmount {
  value?: string | number;
  currency?: string;
}

export interface RawMarketMetadata {
  slug?: string;
  icon?: string;
  title?: string;
  outcome?: string;
  eventSlug?: string;
}

export interface RawPosition {
  netPosition?: string;
  netPositionDecimal?: string;
  qtyBought?: string;
  qtyBoughtDecimal?: string;
  qtySold?: string;
  qtySoldDecimal?: string;
  qtyAvailable?: string;
  qtyAvailableDecimal?: string;
  bodPosition?: string;
  bodPositionDecimal?: string;
  cost?: RawAmount;
  realized?: RawAmount;
  cashValue?: RawAmount;
  expired?: boolean;
  updateTime?: string;
  marketMetadata?: RawMarketMetadata;
}

export interface RawPositionsResponse {
  positions?: Record<string, RawPosition>;
  nextCursor?: string;
  eof?: boolean;
}

export interface RawTrade {
  id?: string;
  marketSlug?: string;
  state?: string;
  createTime?: string;
  updateTime?: string;
  price?: RawAmount;
  qty?: string;
  qtyDecimal?: string;
  isAggressor?: boolean;
  costBasis?: RawAmount;
  realizedPnl?: RawAmount;
}

export interface RawPositionResolution {
  marketSlug?: string;
  beforePosition?: RawPosition;
  afterPosition?: RawPosition;
  updateTime?: string;
  tradeId?: string;
  side?: string;
}

export interface RawBalanceTransaction {
  transactionId?: string;
  status?: string;
  amount?: RawAmount;
  updateTime?: string;
  createTime?: string;
}

export interface RawAccountBalanceChange extends RawBalanceTransaction {
  transactions?: RawBalanceTransaction[];
}

export type RawActivityType =
  | "ACTIVITY_TYPE_TRADE"
  | "ACTIVITY_TYPE_POSITION_RESOLUTION"
  | "ACTIVITY_TYPE_ACCOUNT_DEPOSIT"
  | "ACTIVITY_TYPE_ACCOUNT_ADVANCED_DEPOSIT"
  | "ACTIVITY_TYPE_ACCOUNT_WITHDRAWAL"
  | "ACTIVITY_TYPE_REFERRAL_BONUS"
  | "ACTIVITY_TYPE_TRANSFER"
  | "ACTIVITY_TYPE_TAKER_FEE_REBATE"
  | "ACTIVITY_TYPE_LIQUIDITY_PROGRAM"
  | string;

export interface RawActivity {
  type?: RawActivityType;
  trade?: RawTrade;
  positionResolution?: RawPositionResolution;
  accountBalanceChange?: RawAccountBalanceChange;
}

export interface RawActivitiesResponse {
  activities?: RawActivity[];
  nextCursor?: string;
  eof?: boolean;
}

export interface RawUserBalance {
  currentBalance?: number;
  currency?: string;
  lastUpdated?: string;
  buyingPower?: number;
  assetNotional?: number;
  assetAvailable?: number;
  pendingCredit?: number;
  openOrders?: number;
  unsettledFunds?: number;
  marginRequirement?: number;
  balanceReservation?: number;
}

export interface RawBalancesResponse {
  balances?: RawUserBalance[];
}
