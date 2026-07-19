export const AUTOMATION_RULES = {
  triggerPrice: 0.95,
  maxPrice: 0.96,
  maxTriggerPrice: 0.96,
  maxConfigurablePrice: 0.99,
  targetStake: 1,
  maxRetries: 3,
} as const;

export type QuoteBlockReason =
  | "not-live"
  | "market-closed"
  | "already-bet"
  | "below-trigger"
  | "above-price-cap"
  | "balance-floor"
  | "insufficient-buying-power";

export interface QuoteEvaluationInput {
  bestAsk: number;
  triggerPrice: number;
  executionCap: number;
  currentBalance: number;
  buyingPower: number;
  balanceFloor: number;
  isLive: boolean;
  isOpen: boolean;
  alreadyBet: boolean;
}

export type QuoteEvaluation =
  | {
      eligible: true;
      limitPrice: number;
      quantity: number;
      targetStake: number;
    }
  | {
      eligible: false;
      reason: QuoteBlockReason;
    };

export function evaluateQuote(input: QuoteEvaluationInput): QuoteEvaluation {
  const {
    bestAsk,
    triggerPrice,
    executionCap,
    currentBalance,
    buyingPower,
    balanceFloor,
    isLive,
    isOpen,
    alreadyBet,
  } = input;

  if (!isLive) return { eligible: false, reason: "not-live" };
  if (!isOpen) return { eligible: false, reason: "market-closed" };
  if (alreadyBet) return { eligible: false, reason: "already-bet" };
  if (bestAsk < triggerPrice) {
    return { eligible: false, reason: "below-trigger" };
  }
  if (bestAsk > executionCap) {
    return { eligible: false, reason: "above-price-cap" };
  }
  if (currentBalance - AUTOMATION_RULES.targetStake < balanceFloor) {
    return { eligible: false, reason: "balance-floor" };
  }
  if (buyingPower < AUTOMATION_RULES.targetStake) {
    return { eligible: false, reason: "insufficient-buying-power" };
  }

  return {
    eligible: true,
    limitPrice: executionCap,
    quantity: Number(
      (AUTOMATION_RULES.targetStake / executionCap).toFixed(6),
    ),
    targetStake: AUTOMATION_RULES.targetStake,
  };
}
