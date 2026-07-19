import { describe, expect, it } from "vitest";
import {
  hasSustainedRateLimitRecovery,
  isRateLimitError,
  MarketWorkGate,
  retryPlan,
  waitForRetryOrConfigChange,
} from "./worker-runtime";

describe("automation worker rate-limit backoff", () => {
  it("recognizes SDK and Cloudflare rate-limit errors", () => {
    expect(isRateLimitError({ status: 429 })).toBe(true);
    expect(isRateLimitError(new Error("Error 1015: You are being rate limited"))).toBe(
      true,
    );
    expect(isRateLimitError(new Error("Temporary connection failure"))).toBe(false);
  });

  it("backs off exponentially and caps rate-limit retries at thirty seconds", () => {
    expect(retryPlan({ status: 429 }, 1_000)).toEqual({
      delayMs: 1_000,
      nextRateLimitDelayMs: 2_000,
    });
    expect(retryPlan({ status: 429 }, 16_000)).toEqual({
      delayMs: 16_000,
      nextRateLimitDelayMs: 30_000,
    });
    expect(retryPlan({ status: 429 }, 30_000)).toEqual({
      delayMs: 30_000,
      nextRateLimitDelayMs: 30_000,
    });
  });

  it("uses the normal retry delay without discarding accumulated backoff", () => {
    expect(retryPlan(new Error("Temporary connection failure"), 16_000)).toEqual({
      delayMs: 15_000,
      nextRateLimitDelayMs: 16_000,
    });
  });

  it("resets accumulated backoff only after one clean minute", () => {
    const lastRateLimitAt = 1_000;

    expect(hasSustainedRateLimitRecovery(lastRateLimitAt, 60_999)).toBe(false);
    expect(hasSustainedRateLimitRecovery(lastRateLimitAt, 61_000)).toBe(true);
    expect(hasSustainedRateLimitRecovery(null, 61_000)).toBe(false);
  });

  it("coalesces a burst of updates into one in-flight check per market", () => {
    const gate = new MarketWorkGate();

    expect(gate.begin("market-1")).toBe(true);
    for (let update = 0; update < 100; update += 1) {
      expect(gate.begin("market-1")).toBe(false);
    }

    gate.end("market-1");
    expect(gate.begin("market-1")).toBe(true);
  });

  it("interrupts a long retry as soon as automation settings change", async () => {
    let updatedAt = "before";
    const sleeps: number[] = [];

    const result = await waitForRetryOrConfigChange({
      delayMs: 300_000,
      initialConfigUpdatedAt: updatedAt,
      readConfigUpdatedAt: () => updatedAt,
      isStopping: () => false,
      sleepFn: async (milliseconds) => {
        sleeps.push(milliseconds);
        updatedAt = "after";
      },
    });

    expect(result).toBe("config-changed");
    expect(sleeps).toEqual([250]);
  });
});
