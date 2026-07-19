import { describe, expect, it } from "vitest";
import { computeChartDomain } from "@/lib/chart-scale";

describe("computeChartDomain", () => {
  it("keeps auto scale focused on the active series", () => {
    const domain = computeChartDomain([100, 102, 105], "auto");

    expect(domain.minimum).toBeGreaterThan(0);
    expect(domain.minimum).toBeLessThan(100);
    expect(domain.maximum).toBeGreaterThan(105);
  });

  it("anchors a positive series to zero when requested", () => {
    const domain = computeChartDomain([100, 102, 105], "zero");

    expect(domain.minimum).toBe(0);
    expect(domain.maximum).toBeGreaterThan(105);
  });

  it("creates equal positive and negative bounds for symmetric scale", () => {
    const domain = computeChartDomain([-20, 60], "symmetric");

    expect(domain.minimum).toBe(-domain.maximum);
    expect(domain.maximum).toBeGreaterThan(60);
  });

  it("expands a flat series into a usable domain", () => {
    const domain = computeChartDomain([0, 0], "auto");

    expect(domain.minimum).toBeLessThan(0);
    expect(domain.maximum).toBeGreaterThan(0);
  });
});
