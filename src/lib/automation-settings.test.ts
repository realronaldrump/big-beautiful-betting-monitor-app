import { expect, it } from "vitest";
import {
  normalizeBetSettings,
  parseAutomationWrite,
  settingsMatch,
} from "./automation-settings";
it("normalizes reserves identically before write and confirmation", () => {
  const settings = normalizeBetSettings({
    balanceFloor: 100.005,
    triggerPrice: 0.95,
    executionCap: 0.96,
  });
  expect(settings.balanceFloor).toBe(100.01);
  expect(
    settingsMatch(
      { ...settings, enabled: true, revision: 2, updatedAt: "now" },
      { action: "settings", expectedRevision: 1, ...settings },
    ),
  ).toBe(true);
});
it("never accepts a legacy full-form enable", () =>
  expect(() =>
    parseAutomationWrite({
      enabled: true,
      balanceFloor: 100,
      triggerPrice: 0.95,
      executionCap: 0.96,
    }),
  ).toThrow());
it("allows old pages to stop without overwriting settings", () =>
  expect(
    parseAutomationWrite({
      enabled: false,
      balanceFloor: 1,
      triggerPrice: 0.1,
      executionCap: 0.1,
    }),
  ).toEqual({ action: "disable" }));
it("strips the master switch from settings edits", () =>
  expect(
    parseAutomationWrite({
      action: "settings",
      expectedRevision: 1,
      enabled: true,
      balanceFloor: 100,
      triggerPrice: 0.95,
      executionCap: 0.96,
    }),
  ).not.toHaveProperty("enabled"));
