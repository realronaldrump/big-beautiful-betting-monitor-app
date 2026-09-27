import type { AutomationConfig } from "@/automation/store";
import { parseAutomationConfig } from "@/automation/config-validation";

export type BetSettings = Pick<
  AutomationConfig,
  "balanceFloor" | "triggerPrice" | "executionCap"
>;
export type AutomationWrite =
  | ({ action: "settings"; expectedRevision: number } & BetSettings)
  | { action: "enable"; expectedRevision: number }
  | { action: "disable" };

export function normalizeBetSettings(settings: BetSettings): BetSettings {
  const { balanceFloor, triggerPrice, executionCap } = parseAutomationConfig({
    ...settings,
    enabled: false,
  });
  return { balanceFloor, triggerPrice, executionCap };
}
export function settingsMatch(
  saved: AutomationConfig,
  mutation: AutomationWrite,
) {
  if (mutation.action === "disable") return !saved.enabled;
  if (mutation.action === "enable") return saved.enabled;
  return (
    saved.balanceFloor === mutation.balanceFloor &&
    saved.triggerPrice === mutation.triggerPrice &&
    saved.executionCap === mutation.executionCap
  );
}
export function parseAutomationWrite(value: unknown): AutomationWrite {
  if (!value || typeof value !== "object")
    throw new Error("Automation settings must be a JSON object.");
  const input = value as Record<string, unknown>;
  // Keep Off usable in pages opened before deployment. Legacy writes cannot arm or change settings.
  if (
    input.action === "disable" ||
    (input.action === undefined && input.enabled === false)
  )
    return { action: "disable" };
  if (
    !Number.isSafeInteger(input.expectedRevision) ||
    Number(input.expectedRevision) < 0
  )
    throw new Error("Reload the page to use the current settings controls.");
  if (input.action === "enable")
    return {
      action: "enable",
      expectedRevision: Number(input.expectedRevision),
    };
  if (input.action === "settings")
    return {
      action: "settings",
      expectedRevision: Number(input.expectedRevision),
      ...normalizeBetSettings(input as unknown as BetSettings),
    };
  throw new Error("Unknown automation action. Reload the page and try again.");
}
