import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("appPath", () => {
  it("keeps root-relative paths for local checks", async () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "");
    const { appPath } = await import("./app-path");

    expect(appPath("api/health")).toBe("/api/health");
  });

  it("prefixes browser requests with the production base path", async () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/betting/");
    const { appPath } = await import("./app-path");

    expect(appPath("/api/portfolio")).toBe("/betting/api/portfolio");
  });
});
