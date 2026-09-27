import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { AUTOMATION_RULES } from "@/automation/strategy";

export type AutomationWorkerState =
  "off" | "starting" | "watching" | "stopped" | "error";

export type AttemptStatus =
  | "submitting"
  | "retryable"
  | "submitted"
  | "filled"
  | "rejected"
  | "exhausted"
  | "ambiguous"
  | "canceled";

export interface AutomationConfig {
  revision: number;
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
  attemptId: string;
  reservedDebit: number;
  phase: "preview" | "dispatch" | "complete" | "unknown";
  status: AttemptStatus;
  attempts: number;
  orderId: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationSnapshot {
  credentialsConfigured: boolean;
  generatedAt: string;
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
  revision: number;
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
  attempt_id: string;
  reserved_debit: number;
  phase: MarketAttempt["phase"];
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

export class ConfigConflictError extends Error {
  constructor() {
    super(
      "Settings changed in another tab. Review the current values and save again.",
    );
  }
}

const MAX_ATTEMPTS = AUTOMATION_RULES.maxRetries + 1;

function now() {
  return new Date().toISOString();
}

function mapConfig(row: ConfigRow): AutomationConfig {
  return {
    revision: row.revision,
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
    attemptId: row.attempt_id,
    reservedDebit: row.reserved_debit,
    phase: row.phase,
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
    try {
      this.db.pragma("busy_timeout = 5000");
      if (
        databasePath !== ":memory:" &&
        this.db.pragma("journal_mode", { simple: true }) !== "wal"
      ) {
        this.db.pragma("journal_mode = WAL");
      }
      this.db.pragma("foreign_keys = ON");
      this.db.transaction(() => this.migrate()).immediate();
    } catch (error) {
      this.db.close();
      throw error;
    }
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

      CREATE TABLE IF NOT EXISTS api_pacing (
        id INTEGER PRIMARY KEY CHECK (id = 1), next_at INTEGER NOT NULL
      );
      INSERT OR IGNORE INTO api_pacing VALUES (1, 0);
      CREATE TABLE IF NOT EXISTS portfolio_cache (
        id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT, started_at INTEGER NOT NULL DEFAULT 0,
        owner TEXT, lease_until INTEGER NOT NULL DEFAULT 0
      );
      INSERT OR IGNORE INTO portfolio_cache (id) VALUES (1);

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

    if (!configColumns.some((column) => column.name === "revision")) {
      this.db.exec(
        "ALTER TABLE automation_config ADD COLUMN revision INTEGER NOT NULL DEFAULT 0",
      );
    }
    const cacheColumns = this.db
      .prepare("PRAGMA table_info(portfolio_cache)")
      .all() as { name: string }[];
    if (!cacheColumns.some((column) => column.name === "completed_at")) {
      this.db.exec(
        "ALTER TABLE portfolio_cache ADD COLUMN completed_at INTEGER NOT NULL DEFAULT 0",
      );
    }
    const attemptColumns = this.db
      .prepare("PRAGMA table_info(automation_attempts)")
      .all() as { name: string }[];
    if (!attemptColumns.some((column) => column.name === "attempt_id")) {
      this.db.exec(
        "ALTER TABLE automation_attempts ADD COLUMN attempt_id TEXT NOT NULL DEFAULT ''",
      );
    }
    if (!attemptColumns.some((column) => column.name === "reserved_debit")) {
      this.db.exec(
        "ALTER TABLE automation_attempts ADD COLUMN reserved_debit REAL NOT NULL DEFAULT 1.10",
      );
    }
    if (!attemptColumns.some((column) => column.name === "phase")) {
      this.db.exec(
        "ALTER TABLE automation_attempts ADD COLUMN phase TEXT NOT NULL DEFAULT 'unknown'",
      );
    }

    // Materialize added REAL defaults once. Older host SQLite integrity checks
    // misread virtual REAL defaults on pre-migration records as NULL even though
    // normal reads (and current SQLite checks) return the correct value.
    if (Number(this.db.pragma("user_version", { simple: true })) < 1) {
      this.db.exec(
        "UPDATE automation_attempts SET reserved_debit = COALESCE(reserved_debit, 1.10)",
      );
      this.db.pragma("user_version = 1");
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
        `SELECT enabled, balance_floor, trigger_price, execution_cap, updated_at, revision
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
             updated_at = ?, revision = revision + 1
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
    const columns: Record<keyof Omit<AutomationRuntime, "updatedAt">, string> =
      {
        state: "state",
        heartbeatAt: "heartbeat_at",
        lastError: "last_error",
        stopReason: "stop_reason",
        liveEvents: "live_events",
        monitoredMarkets: "monitored_markets",
        currentBalance: "current_balance",
        buyingPower: "buying_power",
      };
    const entries = Object.entries(input).filter(
      ([, value]) => value !== undefined,
    );
    const assignments = entries.map(
      ([key]) => `${columns[key as keyof typeof columns]} = ?`,
    );
    this.db
      .prepare(
        `UPDATE automation_runtime SET ${[...assignments, "updated_at = ?"].join(", ")} WHERE id = 1`,
      )
      .run(...entries.map(([, value]) => value), now());
    return this.getRuntime();
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
               order_id, trigger_price, last_error, created_at, updated_at, attempt_id, phase)
             VALUES (?, ?, ?, ?, 'submitting', 1, NULL, ?, NULL, ?, ?, ?, 'preview')`,
          )
          .run(
            input.marketSlug,
            input.eventSlug,
            input.title,
            input.outcome,
            input.triggerPrice,
            timestamp,
            timestamp,
            randomUUID(),
          );
      } else if (
        existing.status === "retryable" &&
        existing.attempts < MAX_ATTEMPTS
      ) {
        this.db
          .prepare(
            `UPDATE automation_attempts
             SET status = 'submitting', attempts = attempts + 1,
                 trigger_price = ?, last_error = NULL, updated_at = ?,
                 outcome = ?, title = ?, event_slug = ?, order_id = NULL, attempt_id = ?, phase = 'preview', reserved_debit = 0
             WHERE market_slug = ?`,
          )
          .run(
            input.triggerPrice,
            timestamp,
            input.outcome,
            input.title,
            input.eventSlug,
            randomUUID(),
            input.marketSlug,
          );
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

  private mutateAttempt(
    marketSlug: string,
    attemptId: string | undefined,
    mutate: (row: MarketAttempt) => Partial<MarketAttempt> | null,
  ) {
    return this.db
      .transaction(() => {
        const row = this.getAttempt(marketSlug);
        if (!row || (attemptId !== undefined && row.attemptId !== attemptId))
          return false;
        const patch = mutate(row);
        if (!patch) return false;
        const next = { ...row, ...patch };
        this.db
          .prepare(
            `UPDATE automation_attempts SET status = ?, attempts = ?, order_id = ?,
        phase = ?, last_error = ?, reserved_debit = ?, updated_at = ? WHERE market_slug = ?`,
          )
          .run(
            next.status,
            next.attempts,
            next.orderId,
            next.phase,
            next.lastError,
            next.reservedDebit,
            now(),
            marketSlug,
          );
        return true;
      })
      .immediate();
  }

  markDispatching(
    marketSlug: string,
    attemptId: string,
    revision?: number,
    reservedDebit = 1.1,
  ) {
    return this.mutateAttempt(marketSlug, attemptId, (row) => {
      const config = this.getConfig();
      if (
        revision !== undefined &&
        (!config.enabled || config.revision !== revision)
      )
        return null;
      return row.status === "submitting" && row.phase === "preview"
        ? { phase: "dispatch", reservedDebit }
        : null;
    });
  }

  markExplicitRejection(
    marketSlug: string,
    message: string,
    attemptId?: string,
  ): boolean {
    this.mutateAttempt(marketSlug, attemptId, (row) => {
      if (["filled", "canceled", "exhausted", "retryable"].includes(row.status))
        return null;
      return {
        status: row.attempts < MAX_ATTEMPTS ? "retryable" : "exhausted",
        phase: "complete",
        reservedDebit: 0,
        lastError: message,
      };
    });
    const current = this.getAttempt(marketSlug);
    return (
      current?.status === "retryable" &&
      (attemptId === undefined || current.attemptId === attemptId)
    );
  }

  deferAttempt(marketSlug: string, message: string, attemptId?: string) {
    this.mutateAttempt(marketSlug, attemptId, (row) => {
      if (row.status !== "submitting") return null;
      return {
        status: "retryable",
        attempts: Math.max(row.attempts - 1, 0),
        phase: "complete",
        reservedDebit: 0,
        lastError: message,
      };
    });
  }

  bindOrder(marketSlug: string, attemptId: string, orderId: string) {
    return this.mutateAttempt(marketSlug, attemptId, (row) =>
      row.orderId && row.orderId !== orderId ? null : { orderId },
    );
  }

  markSubmitted(marketSlug: string, orderId: string, attemptId?: string) {
    this.mutateAttempt(marketSlug, attemptId, (row) => {
      if (
        !["submitting", "ambiguous", "submitted"].includes(row.status) ||
        (row.orderId && row.orderId !== orderId)
      )
        return null;
      return {
        status: "submitted",
        phase: "complete",
        orderId,
        lastError: null,
      };
    });
  }

  markFilled(marketSlug: string, orderId?: string, attemptId?: string) {
    this.mutateAttempt(marketSlug, attemptId, (row) => {
      if (row.orderId && orderId && row.orderId !== orderId) return null;
      return {
        status: "filled",
        phase: "complete",
        reservedDebit: 0,
        orderId: orderId || row.orderId,
        lastError: null,
      };
    });
  }

  markCanceled(marketSlug: string, orderId: string, attemptId?: string) {
    this.mutateAttempt(marketSlug, attemptId, (row) =>
      row.status === "filled" || (row.orderId && row.orderId !== orderId)
        ? null
        : {
            status: "canceled",
            phase: "complete",
            reservedDebit: 0,
            orderId,
            lastError:
              "Accepted IOC order ended without a fill; the one-order limit remains in effect.",
          },
    );
  }

  markAmbiguous(marketSlug: string, message: string, attemptId?: string) {
    this.mutateAttempt(marketSlug, attemptId, (row) =>
      ["filled", "canceled", "retryable", "exhausted"].includes(row.status)
        ? null
        : {
            status: "ambiguous",
            lastError: message,
          },
    );
  }

  uncertainCashReserve(excludingMarket: string): number {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(reserved_debit), 0) AS reserve FROM automation_attempts
      WHERE market_slug != ? AND (status IN ('submitted', 'ambiguous') OR (status = 'submitting' AND phase = 'dispatch'))`,
      )
      .get(excludingMarket) as { reserve: number };
    return row.reserve;
  }

  listUnresolvedAttempts(): MarketAttempt[] {
    return (
      this.db
        .prepare(
          "SELECT * FROM automation_attempts WHERE status IN ('submitting', 'submitted', 'ambiguous')",
        )
        .all() as AttemptRow[]
    ).map(mapAttempt);
  }

  updateSettings(
    input: Omit<AutomationConfig, "enabled" | "updatedAt" | "revision">,
    expectedRevision: number,
  ) {
    return this.db
      .transaction(() => {
        const current = this.getConfig();
        if (current.revision !== expectedRevision)
          throw new ConfigConflictError();
        return this.updateConfig({ ...input, enabled: current.enabled });
      })
      .immediate();
  }

  setEnabled(enabled: boolean, expectedRevision?: number) {
    return this.db
      .transaction(() => {
        const current = this.getConfig();
        // Off always wins. On requires an explicit, current configuration revision.
        if (enabled && current.revision !== expectedRevision)
          throw new ConfigConflictError();
        return this.updateConfig({ ...current, enabled });
      })
      .immediate();
  }

  claimApiSlot(timestamp: number, spacingMs: number): number {
    return this.db
      .transaction(() => {
        const row = this.db
          .prepare("SELECT next_at FROM api_pacing WHERE id = 1")
          .get() as { next_at: number };
        if (row.next_at > timestamp) return row.next_at - timestamp;
        this.db
          .prepare("UPDATE api_pacing SET next_at = ? WHERE id = 1")
          .run(timestamp + spacingMs);
        return 0;
      })
      .immediate();
  }

  readPortfolioCache(): {
    payload: string | null;
    startedAt: number;
    completedAt: number;
  } {
    const row = this.db
      .prepare(
        "SELECT payload, started_at, completed_at FROM portfolio_cache WHERE id = 1",
      )
      .get() as {
      payload: string | null;
      started_at: number;
      completed_at: number;
    };
    return {
      payload: row.payload,
      startedAt: row.started_at,
      completedAt: row.completed_at,
    };
  }

  claimPortfolioRefresh(owner: string, timestamp: number): boolean {
    return (
      this.db
        .prepare(
          "UPDATE portfolio_cache SET owner = ?, lease_until = ? WHERE id = 1 AND lease_until <= ?",
        )
        .run(owner, timestamp + 75_000, timestamp).changes > 0
    );
  }

  finishPortfolioRefresh(owner: string, payload?: string, startedAt?: number) {
    if (payload !== undefined && startedAt !== undefined) {
      this.db
        .prepare(
          "UPDATE portfolio_cache SET payload = ?, started_at = ?, completed_at = ?, owner = NULL, lease_until = 0 WHERE id = 1 AND owner = ?",
        )
        .run(payload, startedAt, Date.now(), owner);
    } else {
      this.db
        .prepare(
          "UPDATE portfolio_cache SET owner = NULL, lease_until = 0 WHERE id = 1 AND owner = ?",
        )
        .run(owner);
    }
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
      .prepare(
        "SELECT * FROM automation_attempts ORDER BY updated_at DESC LIMIT ?",
      )
      .all(safeLimit) as AttemptRow[];
    return rows.map(mapAttempt);
  }

  getSnapshot(): AutomationSnapshot {
    const config = this.getConfig();
    return {
      generatedAt: now(),
      credentialsConfigured: Boolean(
        process.env.POLYMARKET_KEY_ID && process.env.POLYMARKET_SECRET_KEY,
      ),
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
  if (!sharedStore)
    sharedStore = new AutomationStore(getAutomationDatabasePath());
  return sharedStore;
}
