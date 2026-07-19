import { describe, expect, it } from "vitest";
import { parseAutomationConfig } from "@/automation/config-validation";

describe("parseAutomationConfig", () => {
  it("accepts the switch, floor, trigger, and execution cap", () => {
    expect(
      parseAutomationConfig({
        enabled: true,
        balanceFloor: 42.555,
        triggerPrice: 0.9,
        executionCap: 0.92,
      }),
    ).toEqual({
      enabled: true,
      balanceFloor: 42.56,
      triggerPrice: 0.9,
      executionCap: 0.92,
    });
  });

  it("rejects missing, negative, or excessively large floors", () => {
    expect(() =>
      parseAutomationConfig({
        enabled: true,
        triggerPrice: 0.95,
        executionCap: 0.96,
      }),
    ).toThrow();
    expect(() =>
      parseAutomationConfig({
        enabled: true,
        balanceFloor: -1,
        triggerPrice: 0.95,
        executionCap: 0.96,
      }),
    ).toThrow();
    expect(() =>
      parseAutomationConfig({
        enabled: true,
        balanceFloor: 1_000_001,
        triggerPrice: 0.95,
        executionCap: 0.96,
      }),
    ).toThrow();
  });

  it("rejects caps outside the whole-cent one-to-99-cent range", () => {
    expect(() =>
      parseAutomationConfig({
        enabled: true,
        balanceFloor: 100,
        triggerPrice: 0.95,
        executionCap: 1,
      }),
    ).toThrow("Execution cap must be between 1 and 99 cents.");
    expect(() =>
      parseAutomationConfig({
        enabled: true,
        balanceFloor: 100,
        triggerPrice: 0.95,
        executionCap: 0.965,
      }),
    ).toThrow("Execution cap must use whole cents.");
  });

  it("rejects triggers outside the range ending at the configured cap", () => {
    expect(() =>
      parseAutomationConfig({
        enabled: true,
        balanceFloor: 100,
        triggerPrice: 0,
        executionCap: 0.92,
      }),
    ).toThrow("Trigger price must be between 1 and 92 cents.");
    expect(() =>
      parseAutomationConfig({
        enabled: true,
        balanceFloor: 100,
        triggerPrice: 0.93,
        executionCap: 0.92,
      }),
    ).toThrow("Trigger price must be between 1 and 92 cents.");
    expect(() =>
      parseAutomationConfig({
        enabled: true,
        balanceFloor: 100,
        triggerPrice: 0.97,
        executionCap: 0.99,
      }),
    ).toThrow("Trigger price must be between 1 and 96 cents.");
    expect(() =>
      parseAutomationConfig({
        enabled: true,
        balanceFloor: 100,
        triggerPrice: 0.955,
        executionCap: 0.96,
      }),
    ).toThrow("Trigger price must use whole cents.");
  });
});
