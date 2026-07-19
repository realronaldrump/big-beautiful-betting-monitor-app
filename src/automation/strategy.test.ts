import { describe, expect, it } from "vitest";
import { evaluateQuote } from "@/automation/strategy";

describe("evaluateQuote", () => {
  const eligibleQuote = {
    bestAsk: 0.95,
    triggerPrice: 0.95,
    currentBalance: 250,
    buyingPower: 50,
    balanceFloor: 100,
    isLive: true,
    isOpen: true,
    alreadyBet: false,
  };

  it("builds a capped automatic order for an eligible live quote", () => {
    expect(evaluateQuote(eligibleQuote)).toEqual({
      eligible: true,
      limitPrice: 0.96,
      quantity: 1.041667,
      targetStake: 1,
    });
  });

  it("will not chase a quote above the 96 cent ceiling", () => {
    expect(evaluateQuote({ ...eligibleQuote, bestAsk: 0.9801 })).toEqual({
      eligible: false,
      reason: "above-price-cap",
    });
  });

  it("uses the configured trigger instead of a hard-coded 95 cents", () => {
    expect(
      evaluateQuote({
        ...eligibleQuote,
        bestAsk: 0.9,
        triggerPrice: 0.9,
      }),
    ).toMatchObject({ eligible: true });

    expect(
      evaluateQuote({
        ...eligibleQuote,
        bestAsk: 0.89,
        triggerPrice: 0.9,
      }),
    ).toEqual({ eligible: false, reason: "below-trigger" });
  });

  it("stops before a one dollar bet would cross the balance floor", () => {
    expect(
      evaluateQuote({ ...eligibleQuote, currentBalance: 100.99 }),
    ).toEqual({
      eligible: false,
      reason: "balance-floor",
    });
  });

  it("blocks any market that already has a recorded bet", () => {
    expect(evaluateQuote({ ...eligibleQuote, alreadyBet: true })).toEqual({
      eligible: false,
      reason: "already-bet",
    });
  });
});
