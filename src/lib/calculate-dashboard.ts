import { availableCash } from "@/lib/balances";
import {
  buildAccounting,
  recoveredClosedPosition,
  meaningfulOutcome,
  tradeCash,
  tradePrice,
  type MarketAccounting,
} from "@/lib/trade-accounting";
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
  const parsed =
    typeof value === "number" ? value : Number.parseFloat(value ?? "0");
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

function toPositionRow(
  marketSlug: string,
  position: RawPosition,
  accounting?: MarketAccounting,
): PositionRow {
  const netQuantity = quantity(position);
  const traded =
    boughtQuantity(position) + soldQuantity(position) > POSITION_TOLERANCE;
  const isOpen =
    !position.expired && Math.abs(netQuantity) > POSITION_TOLERANCE;
  const ledgerMatches =
    accounting?.reliable &&
    Math.abs(accounting.position - (isOpen ? netQuantity : 0)) <
      POSITION_TOLERANCE;
  const costBasis = ledgerMatches
    ? accounting.basis
    : amountValue(position.cost);
  const realizedPnl = ledgerMatches
    ? accounting.cashFlow + (isOpen ? costBasis : 0)
    : amountValue(position.realized) -
      (isOpen ? 0 : accounting?.fallbackClosedFees || 0);
  const marketValue = amountValue(position.cashValue);
  const openPnl = isOpen ? marketValue - costBasis : 0;

  return {
    marketSlug,
    side:
      accounting?.side ||
      (isOpen ? (netQuantity < 0 ? "no" : "yes") : undefined),
    amountBet: accounting?.reliable
      ? accounting.amountBet
      : (accounting?.fallbackStake ?? (isOpen ? costBasis : null)),
    feesPaid: accounting?.reliable
      ? accounting.feesPaid
      : accounting?.feesPaid ||
        accounting?.fallbackClosedFees ||
        amountValue(position.fees),
    entryQuantity: accounting?.entryQuantity || Math.abs(netQuantity),
    tradeCount: accounting?.tradeCount || 0,
    openedAt: accounting?.openedAt || position.updateTime || "",
    eventSlug: position.marketMetadata?.eventSlug || accounting?.eventSlug,
    title: position.marketMetadata?.title || slugToTitle(marketSlug),
    outcome:
      meaningfulOutcome(position.marketMetadata?.outcome) ||
      accounting?.outcome ||
      (isOpen ? (netQuantity < 0 ? "NO" : "YES") : "Outcome unavailable"),
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

function latestResolutionPositions(
  activities: RawActivity[],
): Map<string, RawPosition> {
  const latest = new Map<
    string,
    { timestamp: number; position: RawPosition }
  >();

  for (const activity of activities) {
    const resolution = activity.positionResolution;
    const marketSlug = resolution?.marketSlug;
    if (!marketSlug) continue;

    const after = resolution.afterPosition;
    const before = resolution.beforePosition;
    const position = after || before;
    if (!position) continue;

    const timestamp =
      Date.parse(resolution.updateTime || position.updateTime || "") || 0;
    const existing = latest.get(marketSlug);
    if (!existing || timestamp >= existing.timestamp) {
      latest.set(marketSlug, {
        timestamp,
        position: {
          ...position,
          expired: true,
          updateTime: resolution.updateTime || position.updateTime,
          marketMetadata: {
            ...before?.marketMetadata,
            ...position.marketMetadata,
            outcome:
              meaningfulOutcome(position.marketMetadata?.outcome) ||
              before?.marketMetadata?.outcome,
          },
        },
      });
    }
  }

  return new Map(
    [...latest.entries()].map(([slug, value]) => [slug, value.position]),
  );
}

function balanceTransactions(
  change?: RawAccountBalanceChange,
): RawBalanceTransaction[] {
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
    const tradeNotional = tradeCash(trade);

    return [
      {
        id: trade.id || `trade-${index}`,
        marketSlug,
        kind: "trade",
        type,
        label: positionTitles.get(marketSlug) || slugToTitle(marketSlug),
        detail: `${toNumber(trade.qtyDecimal ?? trade.qty).toLocaleString(undefined, { maximumFractionDigits: 2 })} shares at ${tradePrice(trade).toLocaleString("en-US", { style: "currency", currency: "USD" })}`,
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
        marketSlug,
        kind: "settlement",
        type,
        label:
          position?.marketMetadata?.title ||
          positionTitles.get(marketSlug) ||
          slugToTitle(marketSlug),
        detail: `${meaningfulOutcome(position?.marketMetadata?.outcome) || resolution.beforePosition?.marketMetadata?.outcome || "Position"} finished`,
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
  const accounting = buildAccounting(rawActivities);
  const combinedPositions = new Map(
    Object.entries(positionsResponse.positions || {}),
  );

  for (const [slug, resolvedPosition] of latestResolutionPositions(
    rawActivities,
  )) {
    const existing = combinedPositions.get(slug);
    if (
      !existing ||
      (Date.parse(resolvedPosition.updateTime || "") || 0) >
        (Date.parse(existing.updateTime || "") || 0)
    )
      combinedPositions.set(slug, resolvedPosition);
  }

  for (const [slug, account] of accounting) {
    if (!combinedPositions.has(slug)) {
      const recovered = recoveredClosedPosition(account);
      if (recovered) combinedPositions.set(slug, recovered);
    }
  }

  const positions = [...combinedPositions.entries()]
    .map(([slug, position]) =>
      toPositionRow(slug, position, accounting.get(slug)),
    )
    .filter((position) => position.isOpen || position.result !== "open")
    .sort(
      (a, b) =>
        Number(b.isOpen) - Number(a.isOpen) ||
        compareDatesDescending(a.updatedAt, b.updatedAt),
    );

  const positionTitles = new Map(
    positions.map((position) => [position.marketSlug, position.title]),
  );
  const activities = rawActivities
    .flatMap((activity, index) =>
      normalizeActivity(activity, index, positionTitles),
    )
    .sort((a, b) => compareDatesDescending(a.occurredAt, b.occurredAt));

  const closedPositions = positions.filter((position) => !position.isOpen);
  const openPositions = positions.filter((position) => position.isOpen);
  const wins = closedPositions.filter(
    (position) => position.result === "win",
  ).length;
  const losses = closedPositions.filter(
    (position) => position.result === "loss",
  ).length;
  const pushes = closedPositions.filter(
    (position) => position.result === "push",
  ).length;
  const decisiveBets = wins + losses;

  const usdBalance =
    balancesResponse.balances?.find((balance) => balance.currency === "USD") ||
    balancesResponse.balances?.[0];

  let deposits = 0;
  let withdrawals = 0;
  let rewardsAndRebates = 0;
  let otherTransfers = 0;

  for (const activity of rawActivities) {
    for (const transaction of balanceTransactions(
      activity.accountBalanceChange,
    )) {
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
    if (!trade || /BUSTED|REJECTED/.test(trade.state || "")) return total;
    const notional = tradeCash(trade);
    return total + notional;
  }, 0);

  const realizedPnl = positions.reduce(
    (total, position) => total + position.realizedPnl,
    0,
  );
  const estimatedOpenPnl = openPositions.reduce(
    (total, position) => total + position.openPnl,
    0,
  );
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

  let cumulativeRealized = 0;
  const realizedHistory: PnlPoint[] = positions
    .flatMap((position) => {
      const ledger = accounting.get(position.marketSlug);
      const events =
        ledger?.reliable &&
        Math.abs(ledger.position - position.quantity) < POSITION_TOLERANCE
          ? ledger.history
          : !position.isOpen || position.realizedPnl !== 0
            ? [{ occurredAt: position.updatedAt, delta: position.realizedPnl }]
            : [];
      return events.map((event) => ({
        ...event,
        marketSlug: position.marketSlug,
        label: position.title,
        cumulative: 0,
      }));
    })
    .sort(
      (a, b) =>
        (Date.parse(a.occurredAt) || 0) - (Date.parse(b.occurredAt) || 0),
    )
    .map((point) => {
      cumulativeRealized += point.delta;
      return { ...point, cumulative: cumulativeRealized };
    });
  for (const activity of activities) {
    if (activity.kind === "settlement" && activity.marketSlug) {
      const point = realizedHistory.find(
        (entry) =>
          entry.marketSlug === activity.marketSlug &&
          entry.occurredAt === activity.occurredAt,
      );
      if (point) activity.realizedPnl = point.delta;
    }
  }

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
      openPositionValue: openPositions.reduce(
        (total, position) => total + position.marketValue,
        0,
      ),
      tradingVolume,
      currentBalance: usdBalance ? availableCash(usdBalance) : 0,
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
    realizedHistory,
    notes: [
      "Bets are grouped by market. Results and profit/loss include recorded trading fees.",
      "Cash excludes collateral reserved for short positions. Open profit/loss uses current position value minus remaining cost.",
      "Net money added includes completed deposits and withdrawals; advance credits are excluded to avoid counting them twice.",
    ],
  };
}
