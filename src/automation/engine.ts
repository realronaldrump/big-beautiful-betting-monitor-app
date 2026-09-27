import type { CreateOrderParams, CreateOrderResponse } from "polymarket-us";
import { evaluateQuote } from "@/automation/strategy";
import type { AutomationStore } from "@/automation/store";
import type { ParsedOrderExecution } from "./websocket-parsers";
import { RequestCancelledError } from "@/lib/polymarket-rest";

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
  previewOrder(order: CreateOrderParams, check?: () => void): Promise<unknown>;
  createOrder(
    order: CreateOrderParams,
    beforeSend: () => void,
  ): Promise<CreateOrderResponse>;
  getOrder?(orderId: string): Promise<ParsedOrderExecution>;
  getQuote?(marketSlug: string): Promise<MarketQuote>;
  getBalances(): Promise<AccountBalances>;
  sleep(milliseconds: number): Promise<void>;
}

export type ProcessQuoteResult =
  "ignored" | "submitted" | "filled" | "canceled" | "exhausted" | "ambiguous";
export interface QuoteState {
  market: TrackedMarket;
  quote: MarketQuote;
  balances: AccountBalances;
}

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
  return Number(
    (Math.floor((value + 1e-10) / increment) * increment).toFixed(places),
  );
}

function alignUp(value: number, increment: number) {
  if (!Number.isFinite(increment) || increment <= 0) return value;
  const places = Math.min(Math.max(decimalPlaces(increment), 2), 8);
  return Number(
    (Math.ceil((value - 1e-10) / increment) * increment).toFixed(places),
  );
}

function amount(value: number, tick: number) {
  return {
    value: value.toFixed(Math.min(8, Math.max(2, decimalPlaces(tick)))),
    currency: "USD" as const,
  };
}

function isMarketOpen(quote: MarketQuote, market: TrackedMarket) {
  return market.isOpen && (!quote.state || quote.state === "MARKET_STATE_OPEN");
}

function selectCandidate(
  market: TrackedMarket,
  quote: MarketQuote,
  balances: AccountBalances,
  balanceFloor: number,
  triggerPrice: number,
  executionCap: number,
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
      executionCap,
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
  executionCap: number,
): CreateOrderParams | null {
  const tick = market.priceTickSize || 0.01;
  const underlyingLimit =
    candidate.side === "long"
      ? alignDown(executionCap, tick)
      : alignUp(1 - executionCap, tick);
  const effectiveOutcomeLimit =
    candidate.side === "long" ? underlyingLimit : 1 - underlyingLimit;
  if (
    underlyingLimit <= 0 ||
    underlyingLimit >= 1 ||
    candidate.outcomePrice > effectiveOutcomeLimit + 1e-9
  )
    return null;
  const minimumTradeQty = market.minimumTradeQty || 0.01;
  if (minimumTradeQty * effectiveOutcomeLimit > 1 + 1e-9) return null;
  const quantity = alignDown(1 / effectiveOutcomeLimit, minimumTradeQty);
  if (quantity < minimumTradeQty || quantity <= 0) return null;

  return {
    marketSlug: market.marketSlug,
    intent: candidate.intent,
    type: "ORDER_TYPE_LIMIT",
    price: amount(underlyingLimit, tick),
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
  return (
    message.includes("error 1015") || message.includes("being rate limited")
  );
}

function isDefiniteHttpRejection(error: unknown) {
  if (typeof error !== "object" || error === null || !("status" in error)) {
    return false;
  }
  const status = Number((error as { status?: unknown }).status);
  return status >= 400 && status < 500 && ![408, 429, 499].includes(status);
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
  return (
    rejected?.text ||
    rejected?.orderRejectReason ||
    "Order rejected by Polymarket"
  );
}

/** Reserve fees at the limit, with a conservative coefficient covering standard sports
 * fees (including the announced table-tennis increase). Preview can increase the reserve.
 * https://docs.polymarket.us/fees */
export function maximumOrderDebit(order: CreateOrderParams, preview?: unknown) {
  const price = Number(order.price?.value);
  const outcomePrice =
    order.intent === "ORDER_INTENT_BUY_SHORT" ? 1 - price : price;
  const quantity = Number(order.quantity);
  if (
    !Number.isFinite(quantity) ||
    quantity <= 0 ||
    outcomePrice <= 0 ||
    outcomePrice >= 1
  )
    return Infinity;
  const value = outcomePrice * quantity;
  const response = preview as
    | {
        order?: {
          commissionNotionalTotalCollected?: { value?: string };
          commissionsBasisPoints?: string;
        };
      }
    | undefined;
  const fee = Math.max(
    0.1 * quantity * outcomePrice * (1 - outcomePrice),
    Number(response?.order?.commissionNotionalTotalCollected?.value) || 0,
    (value * (Number(response?.order?.commissionsBasisPoints) || 0)) / 10_000,
  );
  return value + Math.ceil((fee - 1e-10) * 100) / 100;
}

export class AutomationEngine {
  private readonly processing = new Set<string>();
  private readonly earlyExecutions = new Map<string, ParsedOrderExecution[]>();

  constructor(
    private readonly store: AutomationStore,
    private readonly adapter: TradingAdapter,
  ) {}

  handleOrderExecution(execution: ParsedOrderExecution) {
    const { id, marketSlug } = execution.order || {};
    if (!id || !marketSlug) return;
    const attempt = this.store.getAttempt(marketSlug);
    if (!attempt) return;
    if (attempt.orderId !== id) {
      // An execution may precede its HTTP acknowledgement. Never apply it by slug.
      if (
        attempt.status === "submitting" &&
        attempt.phase === "dispatch" &&
        !attempt.orderId
      ) {
        const pending = this.earlyExecutions.get(id) || [];
        this.earlyExecutions.set(id, [...pending, execution].slice(-8));
        if (this.earlyExecutions.size > 256)
          this.earlyExecutions.delete(
            this.earlyExecutions.keys().next().value!,
          );
      }
      return;
    }
    const response = { id, executions: [execution] } as CreateOrderResponse;
    if (responseHasAnyFill(response))
      this.store.markFilled(marketSlug, id, attempt.attemptId);
    else if (responseWasRejected(response))
      this.store.markExplicitRejection(
        marketSlug,
        rejectionText(response),
        attempt.attemptId,
      );
    else if (
      ["ORDER_STATE_CANCELED", "ORDER_STATE_EXPIRED"].includes(
        execution.order.state || "",
      ) ||
      ["EXECUTION_TYPE_CANCELED", "EXECUTION_TYPE_EXPIRED"].includes(
        execution.type || "",
      )
    )
      this.store.markCanceled(marketSlug, id, attempt.attemptId);
    else if (execution.order.state?.startsWith("ORDER_STATE_"))
      this.store.markSubmitted(marketSlug, id, attempt.attemptId);
  }

  async reconcileInterruptedAttempts() {
    for (const attempt of this.store.listUnresolvedAttempts()) {
      if (this.processing.has(attempt.marketSlug)) continue;
      if (attempt.status === "submitting" && attempt.phase === "preview") {
        this.store.deferAttempt(
          attempt.marketSlug,
          "Worker restarted before submission; safe to evaluate again.",
          attempt.attemptId,
        );
      } else if (attempt.orderId && this.adapter.getOrder) {
        try {
          this.handleOrderExecution(
            await this.adapter.getOrder(attempt.orderId),
          );
        } catch {
          this.store.markAmbiguous(
            attempt.marketSlug,
            "Waiting to reconcile this order with Polymarket. Automatic retries are blocked.",
            attempt.attemptId,
          );
        }
      } else if (attempt.status !== "ambiguous") {
        this.store.markAmbiguous(
          attempt.marketSlug,
          "Interrupted order has no recorded exchange ID. Check the exchange history; automatic retries are blocked.",
          attempt.attemptId,
        );
      }
    }
  }

  async processQuote(
    input: QuoteState & {
      readCurrent?: () => QuoteState | null;
      isCancelled?: () => boolean;
    },
  ): Promise<ProcessQuoteResult> {
    const slug = input.market.marketSlug;
    if (this.processing.has(slug)) return "ignored";
    this.processing.add(slug);
    const revision = this.store.getConfig().revision;
    const current = () => (input.readCurrent ? input.readCurrent() : input);
    const valid = () => {
      const config = this.store.getConfig();
      return (
        !input.isCancelled?.() &&
        config.enabled &&
        config.revision === revision &&
        current() !== null
      );
    };
    const check = () => {
      if (!valid())
        throw new RequestCancelledError(
          "Settings, market, or connection changed before submission.",
        );
    };
    let preferredSide: CandidateSide | undefined;
    let waitedAttempt: string | undefined;
    try {
      for (;;) {
        if (!valid()) return "ignored";
        const state = current()!;
        const config = this.store.getConfig();
        const previous = this.store.getAttempt(slug);
        if (
          previous?.status === "retryable" &&
          previous.attempts > 0 &&
          previous.attemptId !== waitedAttempt
        ) {
          waitedAttempt = previous.attemptId;
          const delay =
            RETRY_DELAYS_MS[
              Math.min(previous.attempts - 1, RETRY_DELAYS_MS.length - 1)
            ];
          const remaining = Math.max(
            0,
            delay - Math.max(0, Date.now() - Date.parse(previous.updatedAt)),
          );
          if (
            !(await this.waitBeforeRetry(previous.attempts, valid, remaining))
          )
            return "ignored";
          continue;
        }

        const candidate = selectCandidate(
          state.market,
          state.quote,
          state.balances,
          config.balanceFloor,
          config.triggerPrice,
          config.executionCap,
          Boolean(previous && previous.status !== "retryable"),
          preferredSide,
        );
        if (!candidate) return "ignored";
        preferredSide = candidate.side;
        const order = buildOrder(state.market, candidate, config.executionCap);
        if (!order) return "ignored";
        const attempt = this.store.beginAttempt({
          marketSlug: slug,
          eventSlug: state.market.eventSlug,
          title: state.market.marketTitle || state.market.eventTitle,
          outcome: candidate.outcome,
          triggerPrice: candidate.outcomePrice,
        });
        if (!attempt) return "ignored";
        let preview: unknown;
        try {
          preview = await this.adapter.previewOrder(order, check);
        } catch (error) {
          if (
            error instanceof RequestCancelledError ||
            !isDefiniteHttpRejection(error)
          ) {
            this.store.deferAttempt(
              slug,
              errorMessage(error),
              attempt.attemptId,
            );
            if (error instanceof RequestCancelledError) return "ignored";
            throw error;
          }
          if (
            !this.store.markExplicitRejection(
              slug,
              `Preview rejected: ${errorMessage(error)}`,
              attempt.attemptId,
            )
          )
            return "exhausted";
          continue;
        }
        if (!valid()) {
          this.store.deferAttempt(
            slug,
            "Automation settings changed before submission",
            attempt.attemptId,
          );
          return "ignored";
        }
        const beforeSend = () => {
          check();
          const latest = current()!;
          const latestConfig = this.store.getConfig();
          const eligible = selectCandidate(
            latest.market,
            latest.quote,
            latest.balances,
            latestConfig.balanceFloor,
            latestConfig.triggerPrice,
            latestConfig.executionCap,
            false,
            candidate.side,
          );
          const debit = maximumOrderDebit(order, preview);
          if (
            !eligible ||
            Math.min(
              latest.balances.currentBalance,
              latest.balances.buyingPower,
            ) -
              debit <
              latestConfig.balanceFloor - 1e-9
          ) {
            throw new RequestCancelledError(
              "Latest quote or fee-inclusive balance no longer permits this order.",
            );
          }
          if (
            !this.store.markDispatching(
              slug,
              attempt.attemptId,
              revision,
              debit,
            )
          )
            throw new RequestCancelledError(
              "Order reservation or settings changed.",
            );
        };
        let response: CreateOrderResponse;
        try {
          response = await this.adapter.createOrder(order, beforeSend);
        } catch (error) {
          if (
            error instanceof RequestCancelledError ||
            isRateLimitError(error)
          ) {
            this.store.deferAttempt(
              slug,
              errorMessage(error),
              attempt.attemptId,
            );
            if (error instanceof RequestCancelledError) return "ignored";
            throw error;
          }
          if (isDefiniteHttpRejection(error)) {
            if (
              !this.store.markExplicitRejection(
                slug,
                errorMessage(error),
                attempt.attemptId,
              )
            )
              return "exhausted";
            continue;
          }
          this.store.markAmbiguous(
            slug,
            `Submission status unknown: ${errorMessage(error)}`,
            attempt.attemptId,
          );
          return "ambiguous";
        }
        if (!response?.id) {
          this.store.markAmbiguous(
            slug,
            "Polymarket returned no order ID; automatic retries are blocked.",
            attempt.attemptId,
          );
          return "ambiguous";
        }
        this.store.bindOrder(slug, attempt.attemptId, response.id);
        // Process both channels together, with fills taking precedence over a rejected remainder.
        const executions = [
          ...(response.executions || []).map((execution) => ({
            ...execution,
            order: { ...execution.order, id: response.id, marketSlug: slug },
          })),
          ...(this.earlyExecutions.get(response.id) || []),
        ];
        this.earlyExecutions.delete(response.id);
        if (
          responseHasAnyFill({ ...response, executions } as CreateOrderResponse)
        ) {
          this.store.markFilled(slug, response.id, attempt.attemptId);
          return "filled";
        }
        for (const execution of executions)
          this.handleOrderExecution(execution as ParsedOrderExecution);
        // Some compact REST executions omit marketSlug/order ID; the enclosing response is correlated.
        if (responseWasRejected(response))
          this.store.markExplicitRejection(
            slug,
            rejectionText(response),
            attempt.attemptId,
          );
        const recorded = this.store.getAttempt(slug)!;
        if (recorded.status === "retryable") {
          continue;
        }
        if (recorded.status === "exhausted") return "exhausted";
        if (recorded.status === "canceled") return "canceled";
        if (recorded.status === "filled") return "filled";
        this.store.markSubmitted(slug, response.id, attempt.attemptId);
        return "submitted";
      }
    } finally {
      this.processing.delete(slug);
    }
  }

  private async waitBeforeRetry(
    attemptNumber: number,
    valid: () => boolean,
    delayMs?: number,
  ) {
    let remaining =
      delayMs ??
      RETRY_DELAYS_MS[Math.min(attemptNumber - 1, RETRY_DELAYS_MS.length - 1)];
    while (remaining > 0) {
      if (!valid()) return false;
      const interval = Math.min(250, remaining);
      await this.adapter.sleep(interval);
      remaining -= interval;
    }
    return valid();
  }
}
