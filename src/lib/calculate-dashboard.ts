import type {
  ActivityRow,
  BetResult,
  DashboardSnapshot,
  DataMode,
  PnlPoint,
  PositionRow,
} from "@/lib/dashboard-types";
import type {
  RawAccountBalanceChange,
  RawActivitiesResponse,
  RawActivity,
  RawAmount,
  RawBalancesResponse,
  RawBalanceTransaction,
  RawPosition,
  RawPositionsResponse,
} from "@/lib/polymarket-types";

const PUSH_TOLERANCE = 0.005;
const POSITION_TOLERANCE = 0.0001;

interface DashboardInput {
  mode: DataMode;
  positions: RawPositionsResponse;
  activities: RawActivitiesResponse;
  balances: RawBalancesResponse;
  generatedAt?: string;
}

function toNumber(value: string | number | null | undefined): number {
  const parsed = typeof value === "number" ? value : Number.parseFloat(value ?? "0");
  return Number.isFinite(parsed) ? parsed : 0;
}

function amountValue(amount?: RawAmount): number {
  return toNumber(amount?.value);
}

function quantity(position?: RawPosition): number {
  return toNumber(position?.netPositionDecimal ?? position?.netPosition);
}

function boughtQuantity(position?: RawPosition): number {
  return toNumber(position?.qtyBoughtDecimal ?? position?.qtyBought);
}

function soldQuantity(position?: RawPosition): number {
  return toNumber(position?.qtySoldDecimal ?? position?.qtySold);
}

function slugToTitle(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function resultFor(pnl: number, isOpen: boolean): BetResult {
  if (isOpen) return "open";
  if (pnl > PUSH_TOLERANCE) return "win";
  if (pnl < -PUSH_TOLERANCE) return "loss";
  return "push";
}

function toPositionRow(marketSlug: string, position: RawPosition): PositionRow {
  const netQuantity = quantity(position);
  const traded = boughtQuantity(position) + soldQuantity(position) > POSITION_TOLERANCE;
  const isOpen = !position.expired && Math.abs(netQuantity) > POSITION_TOLERANCE;
  const realizedPnl = amountValue(position.realized);
  const costBasis = amountValue(position.cost);
  const marketValue = amountValue(position.cashValue);
  const openPnl = isOpen ? marketValue - costBasis : 0;

  return {
    marketSlug,
    title: position.marketMetadata?.title || slugToTitle(marketSlug),
    outcome: position.marketMetadata?.outcome || (netQuantity < 0 ? "NO" : "YES"),
    result: resultFor(realizedPnl, isOpen || !traded),
    isOpen,
    quantity: netQuantity,
    costBasis,
    marketValue,
    realizedPnl,
    openPnl,
    updatedAt: position.updateTime || "",
  };
}

function latestResolutionPositions(activities: RawActivity[]): Map<string, RawPosition> {
  const latest = new Map<string, { timestamp: number; position: RawPosition }>();

  for (const activity of activities) {
    const resolution = activity.positionResolution;
    const marketSlug = resolution?.marketSlug;
    if (!marketSlug) continue;

    const after = resolution.afterPosition;
    const before = resolution.beforePosition;
    const position = after || before;
    if (!position) continue;

    const timestamp = Date.parse(resolution.updateTime || position.updateTime || "") || 0;
    const existing = latest.get(marketSlug);
    if (!existing || timestamp >= existing.timestamp) {
      latest.set(marketSlug, {
        timestamp,
        position: {
          ...position,
          expired: true,
          updateTime: resolution.updateTime || position.updateTime,
          marketMetadata: position.marketMetadata || before?.marketMetadata || after?.marketMetadata,
        },
      });
    }
  }

  return new Map([...latest.entries()].map(([slug, value]) => [slug, value.position]));
}

function balanceTransactions(change?: RawAccountBalanceChange): RawBalanceTransaction[] {
  if (!change) return [];
  if (change.transactions?.length) return change.transactions;
  if (change.transactionId || change.amount) return [change];
  return [];
}

function isCompleted(status?: string): boolean {
  if (!status) return true;
  return status.toUpperCase().includes("COMPLETED");
}

function activityTimestamp(activity: RawActivity): string {
  return (
    activity.trade?.updateTime ||
    activity.trade?.createTime ||
    activity.positionResolution?.updateTime ||
    balanceTransactions(activity.accountBalanceChange)[0]?.updateTime ||
    balanceTransactions(activity.accountBalanceChange)[0]?.createTime ||
    ""
  );
}

function friendlyActivityType(type?: string): string {
  return (type || "ACTIVITY")
    .replace("ACTIVITY_TYPE_", "")
    .split("_")
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(" ");
}

function normalizeActivity(
  activity: RawActivity,
  index: number,
  positionTitles: Map<string, string>,
): ActivityRow[] {
  const type = activity.type || "ACTIVITY_TYPE_UNKNOWN";

  if (activity.trade) {
    const trade = activity.trade;
    const marketSlug = trade.marketSlug || "unknown-market";
    const tradeNotional = Math.abs(
      amountValue(trade.costBasis) ||
        amountValue(trade.price) * toNumber(trade.qtyDecimal ?? trade.qty),
    );

    return [
      {
        id: trade.id || `trade-${index}`,
        kind: "trade",
        type,
        label: positionTitles.get(marketSlug) || slugToTitle(marketSlug),
        detail: `${toNumber(trade.qtyDecimal ?? trade.qty).toLocaleString(undefined, { maximumFractionDigits: 2 })} shares at ${amountValue(trade.price).toLocaleString("en-US", { style: "currency", currency: "USD" })}`,
        amount: tradeNotional,
        realizedPnl: trade.realizedPnl ? amountValue(trade.realizedPnl) : null,
        status: trade.state || "",
        occurredAt: trade.updateTime || trade.createTime || "",
      },
    ];
  }

  if (activity.positionResolution) {
    const resolution = activity.positionResolution;
    const position = resolution.afterPosition || resolution.beforePosition;
    const marketSlug = resolution.marketSlug || "unknown-market";
    return [
      {
        id: resolution.tradeId || `resolution-${marketSlug}-${index}`,
        kind: "settlement",
        type,
        label: position?.marketMetadata?.title || positionTitles.get(marketSlug) || slugToTitle(marketSlug),
        detail: `${position?.marketMetadata?.outcome || resolution.side || "Position"} finished`,
        amount: null,
        realizedPnl: position?.realized ? amountValue(position.realized) : null,
        status: "SETTLED",
        occurredAt: resolution.updateTime || position?.updateTime || "",
      },
    ];
  }

  const transactions = balanceTransactions(activity.accountBalanceChange);
  if (transactions.length) {
    return transactions.map((transaction, transactionIndex) => {
      const rawAmount = amountValue(transaction.amount);
      const isWithdrawal = type === "ACTIVITY_TYPE_ACCOUNT_WITHDRAWAL";
      return {
        id: transaction.transactionId || `cash-${index}-${transactionIndex}`,
        kind: "cash" as const,
        type,
        label: friendlyActivityType(type),
        detail: transaction.status || "Account balance change",
        amount: isWithdrawal ? -Math.abs(rawAmount) : rawAmount,
        realizedPnl: null,
        status: transaction.status || "",
        occurredAt: transaction.updateTime || transaction.createTime || "",
      };
    });
  }

  return [
    {
      id: `activity-${index}`,
      kind: "other",
      type,
      label: friendlyActivityType(type),
      detail: "Account activity",
      amount: null,
      realizedPnl: null,
      status: "",
      occurredAt: activityTimestamp(activity),
    },
  ];
}

function compareDatesDescending(a: string, b: string): number {
  return (Date.parse(b) || 0) - (Date.parse(a) || 0);
}

export function calculateDashboard({
  mode,
  positions: positionsResponse,
  activities: activitiesResponse,
  balances: balancesResponse,
  generatedAt = new Date().toISOString(),
}: DashboardInput): DashboardSnapshot {
  const rawActivities = activitiesResponse.activities || [];
  const combinedPositions = new Map(Object.entries(positionsResponse.positions || {}));

  for (const [slug, resolvedPosition] of latestResolutionPositions(rawActivities)) {
    if (!combinedPositions.has(slug)) combinedPositions.set(slug, resolvedPosition);
  }

  const positions = [...combinedPositions.entries()]
    .map(([slug, position]) => toPositionRow(slug, position))
    .filter((position) => position.isOpen || position.result !== "open")
    .sort((a, b) => Number(b.isOpen) - Number(a.isOpen) || compareDatesDescending(a.updatedAt, b.updatedAt));

  const positionTitles = new Map(positions.map((position) => [position.marketSlug, position.title]));
  const activities = rawActivities
    .flatMap((activity, index) => normalizeActivity(activity, index, positionTitles))
    .sort((a, b) => compareDatesDescending(a.occurredAt, b.occurredAt));

  const closedPositions = positions.filter((position) => !position.isOpen);
  const openPositions = positions.filter((position) => position.isOpen);
  const wins = closedPositions.filter((position) => position.result === "win").length;
  const losses = closedPositions.filter((position) => position.result === "loss").length;
  const pushes = closedPositions.filter((position) => position.result === "push").length;
  const decisiveBets = wins + losses;

  const usdBalance =
    balancesResponse.balances?.find((balance) => balance.currency === "USD") ||
    balancesResponse.balances?.[0];

  let deposits = 0;
  let withdrawals = 0;
  let rewardsAndRebates = 0;
  let otherTransfers = 0;

  for (const activity of rawActivities) {
    for (const transaction of balanceTransactions(activity.accountBalanceChange)) {
      if (!isCompleted(transaction.status)) continue;
      const value = amountValue(transaction.amount);
      const absoluteValue = Math.abs(value);

      switch (activity.type) {
        case "ACTIVITY_TYPE_ACCOUNT_DEPOSIT":
          deposits += absoluteValue;
          break;
        case "ACTIVITY_TYPE_ACCOUNT_WITHDRAWAL":
          withdrawals += absoluteValue;
          break;
        case "ACTIVITY_TYPE_REFERRAL_BONUS":
        case "ACTIVITY_TYPE_TAKER_FEE_REBATE":
        case "ACTIVITY_TYPE_LIQUIDITY_PROGRAM":
          rewardsAndRebates += value;
          break;
        case "ACTIVITY_TYPE_TRANSFER":
          otherTransfers += value;
          break;
        default:
          break;
      }
    }
  }

  const tradingVolume = rawActivities.reduce((total, activity) => {
    const trade = activity.trade;
    if (!trade || trade.state?.toUpperCase().includes("BUSTED")) return total;
    const notional = Math.abs(
      amountValue(trade.costBasis) ||
        amountValue(trade.price) * toNumber(trade.qtyDecimal ?? trade.qty),
    );
    return total + notional;
  }, 0);

  const realizedPnl = positions.reduce((total, position) => total + position.realizedPnl, 0);
  const estimatedOpenPnl = openPositions.reduce((total, position) => total + position.openPnl, 0);
  const netFunding = deposits - withdrawals;

  let runningPnl = 0;
  const pnlHistory: PnlPoint[] = [...closedPositions]
    .sort((a, b) => -compareDatesDescending(a.updatedAt, b.updatedAt))
    .map((position) => {
      runningPnl += position.realizedPnl;
      return {
        marketSlug: position.marketSlug,
        label: position.title,
        occurredAt: position.updatedAt,
        delta: position.realizedPnl,
        cumulative: runningPnl,
      };
    });

  return {
    mode,
    setupRequired: mode === "demo",
    generatedAt,
    currency: usdBalance?.currency || "USD",
    summary: {
      wins,
      losses,
      pushes,
      winRate: decisiveBets ? (wins / decisiveBets) * 100 : 0,
      closedMarkets: closedPositions.length,
      openMarkets: openPositions.length,
      realizedPnl,
      estimatedOpenPnl,
      estimatedTotalPnl: realizedPnl + estimatedOpenPnl,
      openPositionValue: openPositions.reduce((total, position) => total + position.marketValue, 0),
      tradingVolume,
      currentBalance: usdBalance?.currentBalance || 0,
      buyingPower: usdBalance?.buyingPower || 0,
      unsettledFunds: usdBalance?.unsettledFunds || 0,
      deposits,
      withdrawals,
      netFunding,
      rewardsAndRebates,
      otherTransfers,
      netAccountInflows: netFunding + rewardsAndRebates + otherTransfers,
    },
    positions,
    activities,
    pnlHistory,
    notes: [
      "Each finished bet counts as a win, loss, or tie based on its final profit or loss.",
      "Open profit/loss estimates what you would receive by selling now minus what you paid.",
      "Net money added includes completed deposits and withdrawals; advance credits are excluded to avoid counting them twice.",
    ],
  };
}
