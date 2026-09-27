import type { RawUserBalance } from "./polymarket-types";

export function availableCash(balance: RawUserBalance): number {
  if (Number.isFinite(balance.displayedCash))
    return Number(balance.displayedCash);
  // The US API includes collateral for synthetic shorts in currentBalance.
  return (
    Number(balance.currentBalance || 0) - Number(balance.marginRequirement || 0)
  );
}
