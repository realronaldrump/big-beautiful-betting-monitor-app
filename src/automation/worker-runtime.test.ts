import { describe, expect, it } from "vitest";
import {
  hasSustainedRateLimitRecovery,
  isRateLimitError,
  retryPlan,
} from "./worker-runtime";

describe("automation worker rate-limit backoff", () => {
  it("recognizes SDK and Cloudflare rate-limit errors", () => {
    expect(isRateLimitError({ status: 429 })).toBe(true);
    expect(isRateLimitError(new Error("Error 1015: You are being rate limited"))).toBe(
      true,
    );
    expect(isRateLimitError(new Error("Temporary connection failure"))).toBe(false);
  });

  it("backs off exponentially and caps rate-limit retries at five minutes", () => {
    expect(retryPlan({ status: 429 }, 60_000)).toEqual({
      delayMs: 60_000,
      nextRateLimitDelayMs: 120_000,
    });
    expect(retryPlan({ status: 429 }, 240_000)).toEqual({
      delayMs: 240_000,
      nextRateLimitDelayMs: 300_000,
    });
    expect(retryPlan({ status: 429 }, 300_000)).toEqual({
      delayMs: 300_000,
      nextRateLimitDelayMs: 300_000,
    });
  });

  it("uses the normal retry delay without discarding accumulated backoff", () => {
    expect(retryPlan(new Error("Temporary connection failure"), 240_000)).toEqual({
      delayMs: 15_000,
      nextRateLimitDelayMs: 240_000,
    });
  });

  it("resets accumulated backoff only after ten clean minutes", () => {
    const lastRateLimitAt = 1_000;

    expect(hasSustainedRateLimitRecovery(lastRateLimitAt, 600_999)).toBe(false);
    expect(hasSustainedRateLimitRecovery(lastRateLimitAt, 601_000)).toBe(true);
    expect(hasSustainedRateLimitRecovery(null, 601_000)).toBe(false);
  });
});
