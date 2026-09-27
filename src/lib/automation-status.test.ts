import { expect, it } from "vitest";
import { workerHealth } from "./automation-status";
import { AutomationStore } from "@/automation/store";
it("marks stale workers unavailable and distinguishes readiness from liveness", () => {
  const store = new AutomationStore(":memory:");
  store.updateConfig({
    enabled: true,
    balanceFloor: 100,
    triggerPrice: 0.95,
    executionCap: 0.96,
  });
  store.updateRuntime({
    state: "watching",
    heartbeatAt: "2026-09-27T00:00:00Z",
  });
  expect(
    workerHealth(store.getSnapshot(), Date.parse("2026-09-27T00:02:00Z")),
  ).toMatchObject({ alive: false, ready: false, state: "unavailable" });
  expect(
    workerHealth(store.getSnapshot(), Date.parse("2026-09-27T00:00:02Z")),
  ).toMatchObject({ alive: true, ready: true, state: "watching" });
  store.close();
});
