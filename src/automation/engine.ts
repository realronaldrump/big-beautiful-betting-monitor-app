import type { CreateOrderParams, CreateOrderResponse } from "polymarket-us";
import { evaluateQuote } from "@/automation/strategy";
import type { AutomationStore } from "@/automation/store";

export interface TrackedMarket {
  marketSlug: string;
  eventSlug: string;
  eventTitle: string;
  marketTitle: string;
  longOutcome: string;
  shortOutcome: string;
  minimumTradeQty: number;
  priceTickSize: number;
  isLive: boolean;
  isOpen: boolean;
}

export interface MarketQuote {
  bestBid?: number;
  bestAsk?: number;
  state?: string;
}

export interface AccountBalances {
  currentBalance: number;
  buyingPower: number;
}

export interface TradingAdapter {
  previewOrder(order: CreateOrderParams): Promise<unknown>;
  createOrder(order: CreateOrderParams): Promise<CreateOrderResponse>;
  getQuote(marketSlug: string): Promise<MarketQuote>;
  getBalances(): Promise<AccountBalances>;
  sleep(milliseconds: number): Promise<void>;
}

export type ProcessQuoteResult =
  | "ignored"
  | "submitted"
  | "filled"
  | "exhausted"
  | "ambiguous";

type CandidateSide = "long" | "short";

interface Candidate {
  side: CandidateSide;
  outcome: string;
  outcomePrice: number;
  intent: "ORDER_INTENT_BUY_LONG" | "ORDER_INTENT_BUY_SHORT";
}

const RETRY_DELAYS_MS = [1_000, 2_000, 4_000] as const;

function decimalPlaces(value: number) {
  const text = value.toString();
  return text.includes(".") ? text.split(".")[1].length : 0;
}

function alignDown(value: number, increment: number) {
  if (!Number.isFinite(increment) || increment <= 0) return value;
  const places = Math.min(Math.max(decimalPlaces(increment), 2), 8);
  return Number((Math.floor((value + 1e-10) / increment) * increment).toFixed(places));
}

function alignUp(value: number, increment: number) {
  if (!Number.isFinite(increment) || increment <= 0) return value;
  const places = Math.min(Math.max(decimalPlaces(increment), 2), 8);
  return Number((Math.ceil((value - 1e-10) / increment) * increment).toFixed(places));
}

function amount(value: number) {
  return { value: value.toFixed(2), currency: "USD" as const };
}

function isMarketOpen(quote: MarketQuote, market: TrackedMarket) {
  return (
    market.isOpen &&
    (!quote.state || quote.state === "MARKET_STATE_OPEN")
  );
}

function selectCandidate(
  market: TrackedMarket,
  quote: MarketQuote,
  balances: AccountBalances,
  balanceFloor: number,
  triggerPrice: number,
  alreadyBet: boolean,
  preferredSide?: CandidateSide,
): Candidate | null {
  const candidates: Candidate[] = [];

  if (quote.bestAsk !== undefined) {
    candidates.push({
      side: "long",
      outcome: market.longOutcome,
      outcomePrice: quote.bestAsk,
      intent: "ORDER_INTENT_BUY_LONG",
    });
  }
  if (quote.bestBid !== undefined) {
    candidates.push({
      side: "short",
      outcome: market.shortOutcome,
      outcomePrice: Number((1 - quote.bestBid).toFixed(6)),
      intent: "ORDER_INTENT_BUY_SHORT",
    });
  }

  const ordered = preferredSide
    ? candidates.filter((candidate) => candidate.side === preferredSide)
    : candidates.sort((a, b) => b.outcomePrice - a.outcomePrice);

  for (const candidate of ordered) {
    const decision = evaluateQuote({
      bestAsk: candidate.outcomePrice,
      currentBalance: balances.currentBalance,
      buyingPower: balances.buyingPower,
      balanceFloor,
      triggerPrice,
      isLive: market.isLive,
      isOpen: isMarketOpen(quote, market),
      alreadyBet,
    });
    if (decision.eligible) return candidate;
  }

  return null;
}

function buildOrder(
  market: TrackedMarket,
  candidate: Candidate,
): CreateOrderParams | null {
  const tick = market.priceTickSize || 0.01;
  const underlyingLimit =
    candidate.side === "long"
      ? alignDown(0.96, tick)
      : alignUp(1 - 0.96, tick);
  const effectiveOutcomeLimit =
    candidate.side === "long" ? underlyingLimit : 1 - underlyingLimit;
  const minimumTradeQty = market.minimumTradeQty || 0.01;
  if (minimumTradeQty * effectiveOutcomeLimit > 1 + 1e-9) return null;
  const quantity = alignDown(1 / effectiveOutcomeLimit, minimumTradeQty);
  if (quantity < minimumTradeQty || quantity <= 0) return null;

  return {
    marketSlug: market.marketSlug,
    intent: candidate.intent,
    type: "ORDER_TYPE_LIMIT",
    price: amount(underlyingLimit),
    quantity,
    tif: "TIME_IN_FORCE_IMMEDIATE_OR_CANCEL",
    participateDontInitiate: false,
    manualOrderIndicator: "MANUAL_ORDER_INDICATOR_AUTOMATIC",
    synchronousExecution: true,
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Order request failed";
}

function isRateLimitError(error: unknown) {
  if (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    Number((error as { status?: unknown }).status) === 429
  ) {
    return true;
  }
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes("error 1015") || message.includes("being rate limited");
}

function isDefiniteHttpRejection(error: unknown) {
  if (typeof error !== "object" || error === null || !("status" in error)) {
    return false;
  }
  const status = Number((error as { status?: unknown }).status);
  return status >= 400 && status < 500;
}

function responseWasRejected(response: CreateOrderResponse) {
  return Boolean(
    response.executions?.some(
      (execution) =>
        execution.type === "EXECUTION_TYPE_REJECTED" ||
        execution.order?.state === "ORDER_STATE_REJECTED",
    ),
  );
}

function responseHasAnyFill(response: CreateOrderResponse) {
  return Boolean(
    response.executions?.some(
      (execution) =>
        execution.type === "EXECUTION_TYPE_FILL" ||
        execution.type === "EXECUTION_TYPE_PARTIAL_FILL" ||
        execution.order?.state === "ORDER_STATE_FILLED" ||
        execution.order?.state === "ORDER_STATE_PARTIALLY_FILLED" ||
        Number(execution.order?.cumQuantity || 0) > 0,
    ),
  );
}

function rejectionText(response: CreateOrderResponse) {
  const rejected = response.executions?.find(
    (execution) =>
      execution.type === "EXECUTION_TYPE_REJECTED" ||
      execution.order?.state === "ORDER_STATE_REJECTED",
  );
  return rejected?.text || rejected?.orderRejectReason || "Order rejected by Polymarket";
}

export class AutomationEngine {
  private readonly processing = new Set<string>();

  constructor(
    private readonly store: AutomationStore,
    private readonly adapter: TradingAdapter,
  ) {}

  async processQuote(input: {
    market: TrackedMarket;
    quote: MarketQuote;
    balances: AccountBalances;
  }): Promise<ProcessQuoteResult> {
    const { market } = input;
    if (this.processing.has(market.marketSlug)) return "ignored";
    this.processing.add(market.marketSlug);

    try {
      let quote = input.quote;
      let balances = input.balances;
      let preferredSide: CandidateSide | undefined;

      for (;;) {
        const config = this.store.getConfig();
        if (!config.enabled) return "ignored";

        const previous = this.store.getAttempt(market.marketSlug);
        const alreadyBet = Boolean(previous && previous.status !== "retryable");
        const candidate = selectCandidate(
          market,
          quote,
          balances,
          config.balanceFloor,
          config.triggerPrice,
          alreadyBet,
          preferredSide,
        );
        if (!candidate) return "ignored";
        preferredSide = candidate.side;

        const order = buildOrder(market, candidate);
        if (!order) return "ignored";

        const attempt = this.store.beginAttempt({
          marketSlug: market.marketSlug,
          eventSlug: market.eventSlug,
          title: market.marketTitle || market.eventTitle,
          outcome: candidate.outcome,
          triggerPrice: candidate.outcomePrice,
        });
        if (!attempt) return "ignored";
        try {
          await this.adapter.previewOrder(order);
        } catch (error) {
          if (isRateLimitError(error)) {
            this.store.deferAttempt(market.marketSlug, errorMessage(error));
            throw error;
          }
          const canRetry = this.store.markExplicitRejection(
            market.marketSlug,
            `Preview failed: ${errorMessage(error)}`,
          );
          if (!canRetry) return "exhausted";
          await this.waitBeforeRetry(attempt.attempts);
          quote = await this.adapter.getQuote(market.marketSlug);
          balances = await this.adapter.getBalances();
          continue;
        }

        if (!this.store.getConfig().enabled) {
          this.store.markExplicitRejection(
            market.marketSlug,
            "Automation was switched off before submission",
          );
          return "ignored";
        }

        try {
          const response = await this.adapter.createOrder(order);
          if (responseHasAnyFill(response)) {
            this.store.markFilled(market.marketSlug, response.id);
            return "filled";
          }
          if (responseWasRejected(response)) {
            const canRetry = this.store.markExplicitRejection(
              market.marketSlug,
              rejectionText(response),
            );
            if (!canRetry) return "exhausted";
            await this.waitBeforeRetry(attempt.attempts);
            quote = await this.adapter.getQuote(market.marketSlug);
            balances = await this.adapter.getBalances();
            continue;
          }

          if (!response.id) {
            this.store.markAmbiguous(
              market.marketSlug,
              "Polymarket returned no order ID",
            );
            return "ambiguous";
          }

          this.store.markSubmitted(market.marketSlug, response.id);
          return "submitted";
        } catch (error) {
          if (isRateLimitError(error)) {
            this.store.deferAttempt(market.marketSlug, errorMessage(error));
            throw error;
          }
          if (isDefiniteHttpRejection(error)) {
            const canRetry = this.store.markExplicitRejection(
              market.marketSlug,
              errorMessage(error),
            );
            if (!canRetry) return "exhausted";
            await this.waitBeforeRetry(attempt.attempts);
            quote = await this.adapter.getQuote(market.marketSlug);
            balances = await this.adapter.getBalances();
            continue;
          }

          this.store.markAmbiguous(
            market.marketSlug,
            `Submission status unknown: ${errorMessage(error)}`,
          );
          return "ambiguous";
        }
      }
    } finally {
      this.processing.delete(market.marketSlug);
    }
  }

  private async waitBeforeRetry(attemptNumber: number) {
    const delay = RETRY_DELAYS_MS[Math.min(attemptNumber - 1, RETRY_DELAYS_MS.length - 1)];
    await this.adapter.sleep(delay);
  }
}
