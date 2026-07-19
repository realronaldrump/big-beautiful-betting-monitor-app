import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { AutomationStore } from "@/automation/store";

describe("AutomationStore", () => {
  const testDirectories: string[] = [];

  afterEach(() => {
    for (const directory of testDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  function makeStore() {
    const directory = mkdtempSync(path.join(tmpdir(), "bbbm-automation-"));
    testDirectories.push(directory);
    return new AutomationStore(path.join(directory, "automation.sqlite"));
  }

  it("reserves a market only once while an order is in flight", () => {
    const store = makeStore();
    const market = {
      marketSlug: "denver-wins",
      eventSlug: "denver-v-utah",
      title: "Denver v Utah",
      outcome: "Denver",
      triggerPrice: 0.95,
    };

    expect(store.beginAttempt(market)?.attempts).toBe(1);
    expect(store.beginAttempt(market)).toBeNull();

    store.close();
  });

  it("allows three explicit-rejection retries, then exhausts the market", () => {
    const store = makeStore();
    const market = {
      marketSlug: "avalanche-wins",
      eventSlug: "avalanche-v-wild",
      title: "Avalanche v Wild",
      outcome: "Avalanche",
      triggerPrice: 0.95,
    };

    expect(store.beginAttempt(market)?.attempts).toBe(1);
    expect(store.markExplicitRejection(market.marketSlug, "rejected")).toBe(true);
    expect(store.beginAttempt(market)?.attempts).toBe(2);
    expect(store.markExplicitRejection(market.marketSlug, "rejected")).toBe(true);
    expect(store.beginAttempt(market)?.attempts).toBe(3);
    expect(store.markExplicitRejection(market.marketSlug, "rejected")).toBe(true);
    expect(store.beginAttempt(market)?.attempts).toBe(4);
    expect(store.markExplicitRejection(market.marketSlug, "rejected")).toBe(false);
    expect(store.beginAttempt(market)).toBeNull();
    expect(store.getAttempt(market.marketSlug)?.status).toBe("exhausted");

    store.close();
  });

  it("persists the master switch, balance floor, trigger, and cap with safe defaults", () => {
    const store = makeStore();

    expect(store.getConfig()).toMatchObject({
      enabled: false,
      balanceFloor: 100,
      triggerPrice: 0.95,
      executionCap: 0.96,
    });
    expect(
      store.updateConfig({
        enabled: true,
        balanceFloor: 42.5,
        triggerPrice: 0.9,
        executionCap: 0.92,
      }),
    ).toMatchObject({
      enabled: true,
      balanceFloor: 42.5,
      triggerPrice: 0.9,
      executionCap: 0.92,
    });

    store.close();
  });

  it("adds the price defaults without resetting an existing armed database", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "bbbm-automation-legacy-"));
    testDirectories.push(directory);
    const databasePath = path.join(directory, "automation.sqlite");
    const legacyDatabase = new Database(databasePath);
    legacyDatabase.exec(`
      CREATE TABLE automation_config (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
        balance_floor REAL NOT NULL DEFAULT 100 CHECK (balance_floor >= 0),
        updated_at TEXT NOT NULL
      );
      INSERT INTO automation_config (id, enabled, balance_floor, updated_at)
      VALUES (1, 1, 88, '2026-01-01T00:00:00.000Z');
    `);
    legacyDatabase.close();

    const store = new AutomationStore(databasePath);

    expect(store.getConfig()).toMatchObject({
      enabled: true,
      balanceFloor: 88,
      triggerPrice: 0.95,
      executionCap: 0.96,
    });

    store.close();
  });

  it("adds the cap default without changing current persisted settings", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "bbbm-automation-current-"));
    testDirectories.push(directory);
    const databasePath = path.join(directory, "automation.sqlite");
    const currentDatabase = new Database(databasePath);
    currentDatabase.exec(`
      CREATE TABLE automation_config (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
        balance_floor REAL NOT NULL DEFAULT 100 CHECK (balance_floor >= 0),
        trigger_price REAL NOT NULL DEFAULT 0.95
          CHECK (trigger_price >= 0.01 AND trigger_price <= 0.96),
        updated_at TEXT NOT NULL
      );
      INSERT INTO automation_config
        (id, enabled, balance_floor, trigger_price, updated_at)
      VALUES (1, 1, 88, 0.91, '2026-01-01T00:00:00.000Z');
    `);
    currentDatabase.close();

    const store = new AutomationStore(databasePath);

    expect(store.getConfig()).toMatchObject({
      enabled: true,
      balanceFloor: 88,
      triggerPrice: 0.91,
      executionCap: 0.96,
    });

    store.close();
  });
});
