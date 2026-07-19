import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { AUTOMATION_RULES } from "@/automation/strategy";

export type AutomationWorkerState =
  | "off"
  | "starting"
  | "watching"
  | "stopped"
  | "error";

export type AttemptStatus =
  | "submitting"
  | "retryable"
  | "submitted"
  | "filled"
  | "rejected"
  | "exhausted"
  | "ambiguous";

export interface AutomationConfig {
  enabled: boolean;
  balanceFloor: number;
  triggerPrice: number;
  executionCap: number;
  updatedAt: string;
}

export interface AutomationRuntime {
  state: AutomationWorkerState;
  heartbeatAt: string | null;
  lastError: string | null;
  stopReason: string | null;
  liveEvents: number;
  monitoredMarkets: number;
  currentBalance: number | null;
  buyingPower: number | null;
  updatedAt: string;
}

export interface MarketAttemptInput {
  marketSlug: string;
  eventSlug: string;
  title: string;
  outcome: string;
  triggerPrice: number;
}

export interface MarketAttempt extends MarketAttemptInput {
  status: AttemptStatus;
  attempts: number;
  orderId: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationSnapshot {
  config: AutomationConfig;
  runtime: AutomationRuntime;
  rules: {
    triggerPrice: number;
    maxPrice: number;
    maxTriggerPrice: number;
    maxConfigurablePrice: number;
    targetStake: number;
    maxRetries: number;
  };
  recentAttempts: MarketAttempt[];
}

type ConfigRow = {
  enabled: number;
  balance_floor: number;
  trigger_price: number;
  execution_cap: number;
  updated_at: string;
};

type RuntimeRow = {
  state: AutomationWorkerState;
  heartbeat_at: string | null;
  last_error: string | null;
  stop_reason: string | null;
  live_events: number;
  monitored_markets: number;
  current_balance: number | null;
  buying_power: number | null;
  updated_at: string;
};

type AttemptRow = {
  market_slug: string;
  event_slug: string;
  title: string;
  outcome: string;
  status: AttemptStatus;
  attempts: number;
  order_id: string | null;
  trigger_price: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

const MAX_ATTEMPTS = AUTOMATION_RULES.maxRetries + 1;

function now() {
  return new Date().toISOString();
}

function mapConfig(row: ConfigRow): AutomationConfig {
  return {
    enabled: row.enabled === 1,
    balanceFloor: row.balance_floor,
    triggerPrice: row.trigger_price,
    executionCap: row.execution_cap,
    updatedAt: row.updated_at,
  };
}

function mapRuntime(row: RuntimeRow): AutomationRuntime {
  return {
    state: row.state,
    heartbeatAt: row.heartbeat_at,
    lastError: row.last_error,
    stopReason: row.stop_reason,
    liveEvents: row.live_events,
    monitoredMarkets: row.monitored_markets,
    currentBalance: row.current_balance,
    buyingPower: row.buying_power,
    updatedAt: row.updated_at,
  };
}

function mapAttempt(row: AttemptRow): MarketAttempt {
  return {
    marketSlug: row.market_slug,
    eventSlug: row.event_slug,
    title: row.title,
    outcome: row.outcome,
    status: row.status,
    attempts: row.attempts,
    orderId: row.order_id,
    triggerPrice: row.trigger_price,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class AutomationStore {
  private readonly db: Database.Database;

  constructor(databasePath: string) {
    mkdirSync(path.dirname(databasePath), { recursive: true });
    this.db = new Database(databasePath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }

  private migrate() {
    const timestamp = now();
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS automation_config (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
        balance_floor REAL NOT NULL DEFAULT 100 CHECK (balance_floor >= 0),
        trigger_price REAL NOT NULL DEFAULT 0.95
          CHECK (trigger_price >= 0.01 AND trigger_price <= 0.96),
        execution_cap REAL NOT NULL DEFAULT 0.96
          CHECK (execution_cap >= 0.01 AND execution_cap <= 0.99),
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS automation_runtime (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        state TEXT NOT NULL DEFAULT 'off',
        heartbeat_at TEXT,
        last_error TEXT,
        stop_reason TEXT,
        live_events INTEGER NOT NULL DEFAULT 0,
        monitored_markets INTEGER NOT NULL DEFAULT 0,
        current_balance REAL,
        buying_power REAL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS automation_attempts (
        market_slug TEXT PRIMARY KEY,
        event_slug TEXT NOT NULL,
        title TEXT NOT NULL,
        outcome TEXT NOT NULL,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL,
        order_id TEXT,
        trigger_price REAL NOT NULL,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS automation_attempts_updated_idx
        ON automation_attempts(updated_at DESC);
    `);

    const configColumns = this.db
      .prepare("PRAGMA table_info(automation_config)")
      .all() as { name: string }[];
    if (!configColumns.some((column) => column.name === "trigger_price")) {
      this.db.exec(`
        ALTER TABLE automation_config
        ADD COLUMN trigger_price REAL NOT NULL DEFAULT 0.95
          CHECK (trigger_price >= 0.01 AND trigger_price <= 0.96)
      `);
    }
    if (!configColumns.some((column) => column.name === "execution_cap")) {
      this.db.exec(`
        ALTER TABLE automation_config
        ADD COLUMN execution_cap REAL NOT NULL DEFAULT 0.96
          CHECK (execution_cap >= 0.01 AND execution_cap <= 0.99)
      `);
    }

    this.db
      .prepare(
        `INSERT OR IGNORE INTO automation_config
          (id, enabled, balance_floor, trigger_price, execution_cap, updated_at)
         VALUES (1, 0, 100, 0.95, 0.96, ?)`,
      )
      .run(timestamp);
    this.db
      .prepare(
        `INSERT OR IGNORE INTO automation_runtime
          (id, state, updated_at)
         VALUES (1, 'off', ?)`,
      )
      .run(timestamp);
  }

  getConfig(): AutomationConfig {
    const row = this.db
      .prepare(
        `SELECT enabled, balance_floor, trigger_price, execution_cap, updated_at
         FROM automation_config WHERE id = 1`,
      )
      .get() as ConfigRow;
    return mapConfig(row);
  }

  updateConfig(input: {
    enabled: boolean;
    balanceFloor: number;
    triggerPrice: number;
    executionCap: number;
  }): AutomationConfig {
    const timestamp = now();
    this.db
      .prepare(
        `UPDATE automation_config
         SET enabled = ?, balance_floor = ?, trigger_price = ?, execution_cap = ?,
             updated_at = ?
         WHERE id = 1`,
      )
      .run(
        input.enabled ? 1 : 0,
        input.balanceFloor,
        input.triggerPrice,
        input.executionCap,
        timestamp,
      );
    return this.getConfig();
  }

  updateRuntime(
    input: Partial<Omit<AutomationRuntime, "updatedAt">>,
  ): AutomationRuntime {
    const current = this.getRuntime();
    const next = { ...current, ...input, updatedAt: now() };
    this.db
      .prepare(
        `UPDATE automation_runtime SET
          state = ?, heartbeat_at = ?, last_error = ?, stop_reason = ?,
          live_events = ?, monitored_markets = ?, current_balance = ?,
          buying_power = ?, updated_at = ?
         WHERE id = 1`,
      )
      .run(
        next.state,
        next.heartbeatAt,
        next.lastError,
        next.stopReason,
        next.liveEvents,
        next.monitoredMarkets,
        next.currentBalance,
        next.buyingPower,
        next.updatedAt,
      );
    return next;
  }

  getRuntime(): AutomationRuntime {
    const row = this.db
      .prepare("SELECT * FROM automation_runtime WHERE id = 1")
      .get() as RuntimeRow;
    return mapRuntime(row);
  }

  beginAttempt(input: MarketAttemptInput): MarketAttempt | null {
    const reserve = this.db.transaction(() => {
      const existing = this.db
        .prepare("SELECT * FROM automation_attempts WHERE market_slug = ?")
        .get(input.marketSlug) as AttemptRow | undefined;
      const timestamp = now();

      if (!existing) {
        this.db
          .prepare(
            `INSERT INTO automation_attempts
              (market_slug, event_slug, title, outcome, status, attempts,
               order_id, trigger_price, last_error, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'submitting', 1, NULL, ?, NULL, ?, ?)`,
          )
          .run(
            input.marketSlug,
            input.eventSlug,
            input.title,
            input.outcome,
            input.triggerPrice,
            timestamp,
            timestamp,
          );
      } else if (existing.status === "retryable" && existing.attempts < MAX_ATTEMPTS) {
        this.db
          .prepare(
            `UPDATE automation_attempts
             SET status = 'submitting', attempts = attempts + 1,
                 trigger_price = ?, last_error = NULL, updated_at = ?
             WHERE market_slug = ?`,
          )
          .run(input.triggerPrice, timestamp, input.marketSlug);
      } else {
        return null;
      }

      const row = this.db
        .prepare("SELECT * FROM automation_attempts WHERE market_slug = ?")
        .get(input.marketSlug) as AttemptRow;
      return mapAttempt(row);
    });

    return reserve.immediate();
  }

  markExplicitRejection(marketSlug: string, message: string): boolean {
    const row = this.db
      .prepare("SELECT attempts FROM automation_attempts WHERE market_slug = ?")
      .get(marketSlug) as { attempts: number } | undefined;
    if (!row) return false;

    const canRetry = row.attempts < MAX_ATTEMPTS;
    this.db
      .prepare(
        `UPDATE automation_attempts
         SET status = ?, last_error = ?, updated_at = ?
         WHERE market_slug = ?`,
      )
      .run(canRetry ? "retryable" : "exhausted", message, now(), marketSlug);
    return canRetry;
  }

  deferAttempt(marketSlug: string, message: string) {
    this.db
      .prepare(
        `UPDATE automation_attempts
         SET status = 'retryable', attempts = MAX(attempts - 1, 0),
             last_error = ?, updated_at = ?
         WHERE market_slug = ?`,
      )
      .run(message, now(), marketSlug);
  }

  markSubmitted(marketSlug: string, orderId: string) {
    this.updateAttempt(marketSlug, "submitted", orderId, null);
  }

  markFilled(marketSlug: string, orderId?: string) {
    this.updateAttempt(marketSlug, "filled", orderId, null);
  }

  markAmbiguous(marketSlug: string, message: string) {
    this.updateAttempt(marketSlug, "ambiguous", undefined, message);
  }

  private updateAttempt(
    marketSlug: string,
    status: AttemptStatus,
    orderId?: string,
    lastError?: string | null,
  ) {
    this.db
      .prepare(
        `UPDATE automation_attempts
         SET status = ?, order_id = COALESCE(?, order_id), last_error = ?, updated_at = ?
         WHERE market_slug = ?`,
      )
      .run(status, orderId ?? null, lastError ?? null, now(), marketSlug);
  }

  getAttempt(marketSlug: string): MarketAttempt | null {
    const row = this.db
      .prepare("SELECT * FROM automation_attempts WHERE market_slug = ?")
      .get(marketSlug) as AttemptRow | undefined;
    return row ? mapAttempt(row) : null;
  }

  listRecentAttempts(limit = 8): MarketAttempt[] {
    const safeLimit = Math.max(1, Math.min(Math.trunc(limit), 50));
    const rows = this.db
      .prepare("SELECT * FROM automation_attempts ORDER BY updated_at DESC LIMIT ?")
      .all(safeLimit) as AttemptRow[];
    return rows.map(mapAttempt);
  }

  getSnapshot(): AutomationSnapshot {
    const config = this.getConfig();
    return {
      config,
      runtime: this.getRuntime(),
      rules: {
        ...AUTOMATION_RULES,
        triggerPrice: config.triggerPrice,
        maxPrice: config.executionCap,
      },
      recentAttempts: this.listRecentAttempts(),
    };
  }

  close() {
    this.db.close();
  }
}

let sharedStore: AutomationStore | null = null;

export function getAutomationDatabasePath() {
  return (
    process.env.AUTOMATION_DB_PATH ||
    path.join(process.cwd(), ".data", "automation.sqlite")
  );
}

export function getAutomationStore() {
  if (!sharedStore) sharedStore = new AutomationStore(getAutomationDatabasePath());
  return sharedStore;
}
