import type {
  RawActivity,
  RawAmount,
  RawPosition,
  RawPositionResolution,
  RawTrade,
} from "./polymarket-types";

export function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
export function money(value?: RawAmount | null) {
  return numberValue(value?.value);
}
export function ownExecution(trade: RawTrade) {
  return trade.isAggressor === false
    ? trade.passiveExecution
    : trade.aggressorExecution;
}
export function tradeIntent(trade: RawTrade) {
  return ownExecution(trade)?.order?.intent || "";
}
export function tradePrice(trade: RawTrade) {
  const price = money(trade.price);
  return tradeIntent(trade).endsWith("_SHORT") ? 1 - price : price;
}
export function tradeCash(trade: RawTrade) {
  if (trade.cost?.value !== undefined) return Math.abs(money(trade.cost));
  const intent = tradeIntent(trade);
  if (!intent && trade.costBasis?.value !== undefined)
    return Math.abs(money(trade.costBasis));
  const notional =
    tradePrice(trade) * numberValue(trade.qtyDecimal ?? trade.qty);
  const fee = money(ownExecution(trade)?.commissionNotionalCollected);
  return Math.max(0, notional + (intent.includes("SELL") ? -fee : fee));
}
export function meaningfulOutcome(outcome?: string) {
  return outcome &&
    !["none", "neutral", "undefined", ""].includes(outcome.trim().toLowerCase())
    ? outcome
    : undefined;
}

export interface MarketAccounting {
  reliable: boolean;
  tradeCount: number;
  amountBet: number;
  entryQuantity: number;
  feesPaid: number;
  fallbackClosedFees: number;
  fallbackStake: number | null;
  position: number;
  basis: number;
  cashFlow: number;
  bought: number;
  sold: number;
  title?: string;
  outcome?: string;
  side?: "yes" | "no" | "mixed";
  eventSlug?: string;
  openedAt: string;
  updatedAt: string;
  history: { occurredAt: string; delta: number }[];
}

export function buildAccounting(activities: RawActivity[]) {
  const markets = new Map<string, MarketAccounting>();
  const time = (a: RawActivity) =>
    a.trade?.updateTime ||
    a.trade?.createTime ||
    a.positionResolution?.updateTime ||
    "";
  const seen = new Set<string>();
  for (const activity of [...activities].sort(
    (a, b) => (Date.parse(time(a)) || 0) - (Date.parse(time(b)) || 0),
  )) {
    const trade = activity.trade;
    const resolution = activity.positionResolution;
    const slug = trade?.marketSlug || resolution?.marketSlug;
    if (!slug) continue;
    const id = trade?.id
      ? `trade:${trade.id}`
      : resolution?.tradeId
        ? `resolution:${resolution.tradeId}`
        : null;
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    if (trade && /BUSTED|REJECTED/.test(trade.state || "")) continue;
    const account: MarketAccounting =
      markets.get(slug) ||
      ({
        reliable: true,
        tradeCount: 0,
        amountBet: 0,
        entryQuantity: 0,
        feesPaid: 0,
        fallbackClosedFees: 0,
        fallbackStake: null,
        position: 0,
        basis: 0,
        cashFlow: 0,
        bought: 0,
        sold: 0,
        openedAt: time(activity),
        updatedAt: time(activity),
        history: [],
      } satisfies MarketAccounting);
    markets.set(slug, account);
    account.updatedAt = time(activity) || account.updatedAt;
    if (trade) {
      account.tradeCount += 1;
      const execution = ownExecution(trade);
      const intent = tradeIntent(trade);
      const qty = Math.abs(numberValue(trade.qtyDecimal ?? trade.qty));
      const cash = tradeCash(trade);
      account.feesPaid += money(execution?.commissionNotionalCollected);
      const metadata = execution?.order?.marketMetadata;
      account.title ||=
        metadata?.title || trade.market?.title || trade.market?.question;
      account.eventSlug ||= metadata?.eventSlug || trade.market?.eventSlug;
      account.outcome = meaningfulOutcome(metadata?.outcome) || account.outcome;
      if (
        ![
          "ORDER_INTENT_BUY_LONG",
          "ORDER_INTENT_BUY_SHORT",
          "ORDER_INTENT_SELL_LONG",
          "ORDER_INTENT_SELL_SHORT",
        ].includes(intent) ||
        qty <= 0
      ) {
        account.reliable = false;
        continue;
      }
      const buy = intent.includes("BUY");
      const delta =
        (intent === "ORDER_INTENT_BUY_LONG" ||
        intent === "ORDER_INTENT_SELL_SHORT"
          ? 1
          : -1) * qty;
      if (delta > 0) account.bought += qty;
      else account.sold += qty;
      const closing =
        Math.sign(account.position) !== Math.sign(delta)
          ? Math.min(Math.abs(account.position), qty)
          : 0;
      const opening = qty - closing;
      const closingBasis = account.position
        ? (account.basis * closing) / Math.abs(account.position)
        : 0;
      // Buying the opposite contract closes a pair for $1; opening a short by selling
      // the long side locks $1 collateral. Account in outcome cash, not collateral cash.
      const closingCash = buy
        ? closing - (cash * closing) / qty
        : (cash * closing) / qty;
      const openingBasis = buy
        ? (cash * opening) / qty
        : opening - (cash * opening) / qty;
      account.cashFlow += buy ? -cash + closing : cash - opening;
      account.basis = Math.max(0, account.basis - closingBasis + openingBasis);
      account.position += delta;
      if (Math.abs(account.position) < 1e-6) {
        account.position = 0;
        account.basis = 0;
      }
      if (opening) {
        const side = delta > 0 ? "yes" : "no";
        account.side = account.side && account.side !== side ? "mixed" : side;
      }
      account.amountBet += openingBasis;
      account.entryQuantity += opening;
      if (closing)
        account.history.push({
          occurredAt: time(activity),
          delta: closingCash - closingBasis,
        });
    } else if (resolution) {
      const before = resolution.beforePosition;
      const after = resolution.afterPosition;
      const beforeQty = numberValue(
        before?.netPositionDecimal ?? before?.netPosition,
      );
      const afterQty = numberValue(
        after?.netPositionDecimal ?? after?.netPosition,
      );
      account.outcome =
        meaningfulOutcome(before?.marketMetadata?.outcome) || account.outcome;
      account.side ||= beforeQty > 0 ? "yes" : beforeQty < 0 ? "no" : undefined;
      account.title ||=
        before?.marketMetadata?.title || after?.marketMetadata?.title;
      account.eventSlug ||=
        before?.marketMetadata?.eventSlug || after?.marketMetadata?.eventSlug;
      account.fallbackClosedFees += money(before?.fees);
      if (before?.cost)
        account.fallbackStake = Math.max(
          account.fallbackStake || 0,
          money(before.cost),
        );
      if (
        !account.tradeCount ||
        Math.abs(account.position - beforeQty) > 0.0001 ||
        afterQty !== 0
      ) {
        account.reliable = false;
        continue;
      }
      const payout = settlementPayout(resolution);
      if (payout === null) {
        account.reliable = false;
        continue;
      }
      account.cashFlow += payout;
      account.history.push({
        occurredAt: time(activity),
        delta: payout - account.basis,
      });
      account.position = 0;
      account.basis = 0;
    }
  }
  return markets;
}

function settlementPayout(resolution: RawPositionResolution): number | null {
  const before = resolution.beforePosition;
  const after = resolution.afterPosition;
  // This is the exchange's value of the position at resolution, including a void/refund.
  if (before?.cashValue?.value !== undefined)
    return Math.max(0, money(before.cashValue));
  if (before && after?.realized && (before.baseCost || before.cost)) {
    return Math.max(
      0,
      money(after.realized) -
        money(before.realized) +
        (before.baseCost
          ? money(before.baseCost)
          : money(before.cost) - money(before.fees)),
    );
  }
  return null;
}

export function recoveredClosedPosition(
  account: MarketAccounting,
): RawPosition | null {
  if (!account.reliable || !account.tradeCount || account.position !== 0)
    return null;
  return {
    netPositionDecimal: "0",
    qtyBoughtDecimal: String(account.bought),
    qtySoldDecimal: String(account.sold),
    cost: { value: "0" },
    realized: { value: String(account.cashFlow) },
    updateTime: account.updatedAt,
    marketMetadata: {
      title: account.title,
      outcome: account.outcome,
      eventSlug: account.eventSlug,
    },
  };
}
