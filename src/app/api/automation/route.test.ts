import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { AutomationStore } from "@/automation/store";
const state = vi.hoisted(() => ({ store: null as AutomationStore | null }));
vi.mock("@/automation/store", async (original) => ({
  ...(await original<typeof import("@/automation/store")>()),
  getAutomationStore: () => state.store!,
}));
import { POST } from "./route";
beforeEach(() => {
  state.store = new AutomationStore(":memory:");
});
afterEach(() => {
  state.store?.close();
  vi.unstubAllEnvs();
});
function request(body: unknown, origin = "http://localhost") {
  return new NextRequest("http://localhost/api/automation", {
    method: "POST",
    headers: {
      origin,
      host: "localhost",
      "x-bbbm-action": "automation-config",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}
it("rejects cross-origin settings mutations", async () =>
  expect(
    (await POST(request({ action: "disable" }, "https://foreign.example")))
      .status,
  ).toBe(403));
it("keeps Off after a delayed stale-tab settings save", async () => {
  const old = state.store!.updateConfig({
    enabled: true,
    balanceFloor: 100,
    triggerPrice: 0.95,
    executionCap: 0.96,
  });
  expect((await POST(request({ action: "disable" }))).status).toBe(200);
  expect(
    (
      await POST(
        request({
          action: "settings",
          expectedRevision: old.revision,
          balanceFloor: 150,
          triggerPrice: 0.95,
          executionCap: 0.96,
        }),
      )
    ).status,
  ).toBe(409);
  expect(state.store!.getConfig()).toMatchObject({
    enabled: false,
    balanceFloor: 100,
  });
});
it("accepts legacy Off but never a legacy full-config enable", async () => {
  expect(
    (await POST(request({ enabled: false, balanceFloor: 1 }))).status,
  ).toBe(200);
  expect(
    (
      await POST(
        request({
          enabled: true,
          balanceFloor: 100,
          triggerPrice: 0.95,
          executionCap: 0.96,
        }),
      )
    ).status,
  ).toBe(400);
});
it("normalizes and independently reads back cash reserve edits", async () => {
  const config = state.store!.getConfig();
  const response = await POST(
    request({
      action: "settings",
      expectedRevision: config.revision,
      balanceFloor: 100.005,
      triggerPrice: 0.95,
      executionCap: 0.96,
    }),
  );
  expect(response.status).toBe(200);
  expect(state.store!.getConfig()).toMatchObject({
    balanceFloor: 100.01,
    enabled: false,
  });
});
it("rejects enabling without credentials", async () => {
  vi.stubEnv("POLYMARKET_KEY_ID", "");
  vi.stubEnv("POLYMARKET_SECRET_KEY", "");
  expect(
    (await POST(request({ action: "enable", expectedRevision: 0 }))).status,
  ).toBe(503);
  expect(state.store!.getConfig().enabled).toBe(false);
});
