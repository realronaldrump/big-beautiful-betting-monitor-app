import { AUTOMATION_RULES } from "@/automation/strategy";

export function parseAutomationConfig(value: unknown) {
  if (typeof value !== "object" || value === null) {
    throw new Error("Automation settings must be a JSON object.");
  }

  const input = value as {
    enabled?: unknown;
    balanceFloor?: unknown;
    triggerPrice?: unknown;
  };
  if (typeof input.enabled !== "boolean") {
    throw new Error("The automation switch must be true or false.");
  }
  if (
    typeof input.balanceFloor !== "number" ||
    !Number.isFinite(input.balanceFloor) ||
    input.balanceFloor < 0 ||
    input.balanceFloor > 1_000_000
  ) {
    throw new Error("Balance floor must be between 0 and 1,000,000 dollars.");
  }
  if (
    typeof input.triggerPrice !== "number" ||
    !Number.isFinite(input.triggerPrice) ||
    input.triggerPrice < 0.01 ||
    input.triggerPrice > AUTOMATION_RULES.maxPrice
  ) {
    throw new Error("Trigger price must be between 1 and 96 cents.");
  }
  const triggerCents = input.triggerPrice * 100;
  if (Math.abs(triggerCents - Math.round(triggerCents)) > 1e-8) {
    throw new Error("Trigger price must use whole cents.");
  }

  return {
    enabled: input.enabled,
    balanceFloor: Math.round(input.balanceFloor * 100) / 100,
    triggerPrice: Math.round(triggerCents) / 100,
  };
}
