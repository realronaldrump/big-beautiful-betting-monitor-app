import { describe, expect, it } from "vitest";
import { parseAutomationConfig } from "@/automation/config-validation";

describe("parseAutomationConfig", () => {
  it("accepts the switch, floor, and a trigger at or below the hard cap", () => {
    expect(
      parseAutomationConfig({
        enabled: true,
        balanceFloor: 42.555,
        triggerPrice: 0.9,
      }),
    ).toEqual({
      enabled: true,
      balanceFloor: 42.56,
      triggerPrice: 0.9,
    });
  });

  it("rejects missing, negative, or excessively large floors", () => {
    expect(() =>
      parseAutomationConfig({ enabled: true, triggerPrice: 0.95 }),
    ).toThrow();
    expect(() =>
      parseAutomationConfig({
        enabled: true,
        balanceFloor: -1,
        triggerPrice: 0.95,
      }),
    ).toThrow();
    expect(() =>
      parseAutomationConfig({
        enabled: true,
        balanceFloor: 1_000_001,
        triggerPrice: 0.95,
      }),
    ).toThrow();
  });

  it("rejects triggers outside the one-to-96-cent execution range", () => {
    expect(() =>
      parseAutomationConfig({
        enabled: true,
        balanceFloor: 100,
        triggerPrice: 0,
      }),
    ).toThrow("Trigger price must be between 1 and 96 cents.");
    expect(() =>
      parseAutomationConfig({
        enabled: true,
        balanceFloor: 100,
        triggerPrice: 0.97,
      }),
    ).toThrow("Trigger price must be between 1 and 96 cents.");
    expect(() =>
      parseAutomationConfig({
        enabled: true,
        balanceFloor: 100,
        triggerPrice: 0.955,
      }),
    ).toThrow("Trigger price must use whole cents.");
  });
});
