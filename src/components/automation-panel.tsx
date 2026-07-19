"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AutomationSnapshot } from "@/automation/store";
import { formatCurrency, formatDate } from "@/lib/format";
import { appPath } from "@/lib/app-path";

interface AutomationPanelProps {
  initialSnapshot: AutomationSnapshot;
  accountBalance: number;
}

const stateLabels = {
  off: "Off",
  starting: "Starting",
  watching: "Armed",
  stopped: "Stopped",
  error: "Error",
} as const;

type SettingsWrite = Pick<
  AutomationSnapshot["config"],
  "enabled" | "balanceFloor" | "triggerPrice" | "executionCap"
>;

interface SaveConfirmation {
  label: string;
  updatedAt: string;
}

async function readAutomationSnapshot() {
  const response = await fetch(appPath("/api/automation"), {
    cache: "no-store",
  });
  const payload = (await response.json()) as
    | AutomationSnapshot
    | { error?: string };
  if (!response.ok || !("config" in payload)) {
    throw new Error(
      "error" in payload
        ? payload.error
        : "Automation status is unavailable.",
    );
  }
  return payload;
}

function settingsMatch(
  saved: AutomationSnapshot["config"],
  expected: SettingsWrite,
) {
  return (
    saved.enabled === expected.enabled &&
    Math.abs(saved.balanceFloor - expected.balanceFloor) < 0.001 &&
    Math.abs(saved.triggerPrice - expected.triggerPrice) < 0.000001 &&
    Math.abs(saved.executionCap - expected.executionCap) < 0.000001
  );
}

function formatConfirmationTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "just now";
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

export function AutomationPanel({
  initialSnapshot,
  accountBalance,
}: AutomationPanelProps) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [floorInput, setFloorInput] = useState(
    initialSnapshot.config.balanceFloor.toFixed(2),
  );
  const [triggerInput, setTriggerInput] = useState(
    String(Math.round(initialSnapshot.config.triggerPrice * 100)),
  );
  const [capInput, setCapInput] = useState(
    String(Math.round(initialSnapshot.config.executionCap * 100)),
  );
  const draftDirtyRef = useRef(false);
  const savingRef = useRef(false);
  const latestConfigAtRef = useRef(initialSnapshot.config.updatedAt);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  const [refreshError, setRefreshError] = useState("");
  const [confirmation, setConfirmation] =
    useState<SaveConfirmation | null>(null);
  const parsedFloor = floorInput.trim() ? Number(floorInput) : Number.NaN;
  const parsedTriggerCents = triggerInput.trim()
    ? Number(triggerInput)
    : Number.NaN;
  const parsedTriggerPrice = parsedTriggerCents / 100;
  const parsedCapCents = capInput.trim() ? Number(capInput) : Number.NaN;
  const parsedExecutionCap = parsedCapCents / 100;
  const floorFieldDirty =
    !Number.isFinite(parsedFloor) ||
    Math.abs(parsedFloor - snapshot.config.balanceFloor) >= 0.001;
  const triggerFieldDirty =
    !Number.isFinite(parsedTriggerPrice) ||
    Math.abs(parsedTriggerPrice - snapshot.config.triggerPrice) >= 0.000001;
  const capFieldDirty =
    !Number.isFinite(parsedExecutionCap) ||
    Math.abs(parsedExecutionCap - snapshot.config.executionCap) >= 0.000001;
  const maxConfigurableCapCents = Math.round(
    snapshot.rules.maxConfigurablePrice * 100,
  );
  const maxTriggerCents = Math.max(
    1,
    Math.min(
      Number.isFinite(parsedCapCents)
        ? Math.round(parsedCapCents)
        : maxConfigurableCapCents,
      Math.round(snapshot.rules.maxTriggerPrice * 100),
    ),
  );

  const refresh = useCallback(async () => {
    try {
      const payload = await readAutomationSnapshot();
      if (payload.config.updatedAt < latestConfigAtRef.current) return;
      latestConfigAtRef.current = payload.config.updatedAt;
      setSnapshot(payload);
      if (!draftDirtyRef.current && !savingRef.current) {
        setFloorInput(payload.config.balanceFloor.toFixed(2));
        setTriggerInput(
          String(Math.round(payload.config.triggerPrice * 100)),
        );
        setCapInput(String(Math.round(payload.config.executionCap * 100)));
      }
      setConfirmation((current) =>
        current?.updatedAt === payload.config.updatedAt ? current : null,
      );
      setRefreshError("");
    } catch (refreshError) {
      setRefreshError(
        refreshError instanceof Error
          ? refreshError.message
          : "Automation status is unavailable.",
      );
    }
  }, []);

  useEffect(() => {
    const timer = setInterval(refresh, 2_000);
    return () => clearInterval(timer);
  }, [refresh]);

  const writeAndConfirm = useCallback(async (settings: SettingsWrite) => {
    const response = await fetch(appPath("/api/automation"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-BBBM-Action": "automation-config",
      },
      body: JSON.stringify(settings),
    });
    const payload = (await response.json()) as
      | AutomationSnapshot
      | { error?: string };
    if (!response.ok || !("config" in payload)) {
      throw new Error(
        "error" in payload
          ? payload.error
          : "Settings could not be saved.",
      );
    }

    let confirmed: AutomationSnapshot;
    try {
      confirmed = await readAutomationSnapshot();
    } catch {
      throw new Error(
        "The write completed, but the saved settings could not be confirmed. Try again before relying on them.",
      );
    }
    if (!settingsMatch(confirmed.config, settings)) {
      throw new Error(
        "The saved settings did not match your changes. They are not confirmed.",
      );
    }
    return confirmed;
  }, []);

  function markDraftChanged(
    nextFloor: string,
    nextTrigger: string,
    nextCap: string,
  ) {
    const floor = nextFloor.trim() ? Number(nextFloor) : Number.NaN;
    const triggerCents = nextTrigger.trim()
      ? Number(nextTrigger)
      : Number.NaN;
    const capCents = nextCap.trim() ? Number(nextCap) : Number.NaN;
    const dirty =
      !Number.isFinite(floor) ||
      !Number.isFinite(triggerCents) ||
      !Number.isFinite(capCents) ||
      Math.abs(floor - snapshot.config.balanceFloor) >= 0.001 ||
      Math.abs(triggerCents / 100 - snapshot.config.triggerPrice) >= 0.000001 ||
      Math.abs(capCents / 100 - snapshot.config.executionCap) >= 0.000001;
    draftDirtyRef.current = dirty;
    setIsDirty(dirty);
    if (dirty) setConfirmation(null);
    setSettingsError("");
  }

  function beginSaving() {
    savingRef.current = true;
    setIsSaving(true);
    setSettingsError("");
  }

  function finishSaving() {
    savingRef.current = false;
    setIsSaving(false);
  }

  async function saveDraftSettings() {
    if (!Number.isFinite(parsedFloor) || parsedFloor < 0) {
      setSettingsError("Enter a balance floor of zero dollars or more.");
      return;
    }
    if (
      !Number.isFinite(parsedExecutionCap) ||
      parsedCapCents < 1 ||
      parsedCapCents > maxConfigurableCapCents
    ) {
      setSettingsError(
        `Enter an execution cap from 1 to ${maxConfigurableCapCents} cents.`,
      );
      return;
    }
    if (Math.abs(parsedCapCents - Math.round(parsedCapCents)) > 1e-8) {
      setSettingsError("Enter the execution cap in whole cents.");
      return;
    }
    const triggerCents = parsedTriggerPrice * 100;
    if (
      !Number.isFinite(parsedTriggerPrice) ||
      triggerCents < 1 ||
      triggerCents > maxTriggerCents
    ) {
      setSettingsError(
        `Enter a trigger from 1 to ${maxTriggerCents} cents.`,
      );
      return;
    }
    if (Math.abs(triggerCents - Math.round(triggerCents)) > 1e-8) {
      setSettingsError("Enter the trigger in whole cents.");
      return;
    }

    const expected = {
      enabled: snapshot.config.enabled,
      balanceFloor: parsedFloor,
      triggerPrice: parsedTriggerPrice,
      executionCap: parsedExecutionCap,
    };
    beginSaving();
    try {
      const confirmed = await writeAndConfirm(expected);
      latestConfigAtRef.current = confirmed.config.updatedAt;
      setSnapshot(confirmed);
      setFloorInput(confirmed.config.balanceFloor.toFixed(2));
      setTriggerInput(
        String(Math.round(confirmed.config.triggerPrice * 100)),
      );
      setCapInput(String(Math.round(confirmed.config.executionCap * 100)));
      draftDirtyRef.current = false;
      setIsDirty(false);
      setRefreshError("");
      setConfirmation({
        label: "Bet settings locked in",
        updatedAt: confirmed.config.updatedAt,
      });
    } catch (saveError) {
      setSettingsError(
        saveError instanceof Error
          ? saveError.message
          : "Settings could not be saved.",
      );
    } finally {
      finishSaving();
    }
  }

  async function toggleAutomation() {
    if (!snapshot.config.enabled && draftDirtyRef.current) {
      setSettingsError("Save your pending settings before turning Auto-bet on.");
      return;
    }

    const expected = {
      enabled: !snapshot.config.enabled,
      balanceFloor: snapshot.config.balanceFloor,
      triggerPrice: snapshot.config.triggerPrice,
      executionCap: snapshot.config.executionCap,
    };
    beginSaving();
    try {
      const confirmed = await writeAndConfirm(expected);
      latestConfigAtRef.current = confirmed.config.updatedAt;
      setSnapshot(confirmed);
      setRefreshError("");
      if (!draftDirtyRef.current) {
        setFloorInput(confirmed.config.balanceFloor.toFixed(2));
        setTriggerInput(
          String(Math.round(confirmed.config.triggerPrice * 100)),
        );
        setCapInput(String(Math.round(confirmed.config.executionCap * 100)));
        setConfirmation({
          label: `Auto-bet turned ${confirmed.config.enabled ? "on" : "off"}`,
          updatedAt: confirmed.config.updatedAt,
        });
      }
    } catch (saveError) {
      setSettingsError(
        saveError instanceof Error
          ? saveError.message
          : "Auto-bet could not be changed.",
      );
    } finally {
      finishSaving();
    }
  }

  const { config, runtime, rules, recentAttempts } = snapshot;
  const state = config.enabled ? runtime.state : "off";
  const stateLabel = isSaving ? "Saving" : stateLabels[state];
  const armed = config.enabled && state === "watching";

  return (
    <section
      className={`automation panel ${armed ? "automation--armed" : ""}`}
      aria-labelledby="automation-heading"
    >
      <header className="automation__header">
        <div className="automation__heading">
          <div className="automation__title-row">
            <span className="automation__eyebrow">Real money automation</span>
            <span className={`automation__state automation__state--${state}`}>
              <i aria-hidden="true" />
              {stateLabel}
            </span>
          </div>
          <h2 id="automation-heading">Auto-bet</h2>
          <p>Live entries, configurable guardrails, no approval prompts.</p>
        </div>

        <div className="automation__master">
          <span>Master switch</span>
          <button
            className="automation__switch"
            type="button"
            role="switch"
            aria-checked={config.enabled}
            disabled={isSaving}
            onClick={() => void toggleAutomation()}
          >
            <span aria-hidden="true" />
            {config.enabled ? "Turn off" : "Turn on"}
          </button>
        </div>
      </header>

      <div className="automation__body">
        <div className="automation__control-deck">
          <div className="automation__section-head">
            <div>
              <span className="automation__eyebrow">Live bet settings</span>
              <h3>Entry, cap, and reserve</h3>
            </div>
            <span className="automation__draft-badge" data-dirty={isDirty || undefined}>
              {isDirty ? "Unsaved changes" : "Using saved values"}
            </span>
          </div>

          <div className="automation__fields">
            <div className="automation__field">
              <label htmlFor="trigger-price">Entry threshold</label>
              <div className="automation__input-shell automation__trigger">
                <input
                  id="trigger-price"
                  type="number"
                  min="1"
                  max={maxTriggerCents}
                  step="1"
                  inputMode="numeric"
                  value={triggerInput}
                  disabled={isSaving}
                  data-dirty={triggerFieldDirty || undefined}
                  aria-describedby="trigger-price-note"
                  onChange={(event) => {
                    setTriggerInput(event.target.value);
                    markDraftChanged(floorInput, event.target.value, capInput);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void saveDraftSettings();
                    }
                  }}
                />
                <span>¢ or higher</span>
              </div>
              <p id="trigger-price-note">
                Buy either side when its live price reaches this level.
              </p>
            </div>

            <div className="automation__field">
              <label htmlFor="execution-cap">Execution cap</label>
              <div className="automation__input-shell automation__cap">
                <input
                  id="execution-cap"
                  type="number"
                  min="1"
                  max={maxConfigurableCapCents}
                  step="1"
                  inputMode="numeric"
                  value={capInput}
                  disabled={isSaving}
                  data-dirty={capFieldDirty || undefined}
                  aria-describedby="execution-cap-note"
                  onChange={(event) => {
                    setCapInput(event.target.value);
                    markDraftChanged(floorInput, triggerInput, event.target.value);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void saveDraftSettings();
                    }
                  }}
                />
                <span>¢ maximum</span>
              </div>
              <p id="execution-cap-note">
                Never submit an order above this outcome price.
              </p>
            </div>

            <div className="automation__field">
              <label htmlFor="balance-floor">Cash reserve</label>
              <div className="automation__input-shell automation__floor">
                <span>$</span>
                <input
                  id="balance-floor"
                  type="number"
                  min="0"
                  max="1000000"
                  step="0.01"
                  inputMode="decimal"
                  value={floorInput}
                  disabled={isSaving}
                  data-dirty={floorFieldDirty || undefined}
                  onChange={(event) => {
                    setFloorInput(event.target.value);
                    markDraftChanged(event.target.value, triggerInput, capInput);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void saveDraftSettings();
                    }
                  }}
                />
              </div>
              <p>No order may take account cash below this amount.</p>
            </div>
          </div>

          <div className="automation__save-bar">
            <div
              className="automation__save-state"
              data-state={
                isSaving
                  ? "saving"
                  : isDirty
                    ? "dirty"
                    : confirmation
                      ? "confirmed"
                      : "current"
              }
              role="status"
              aria-live="polite"
            >
              <i aria-hidden="true" />
              <span>
                <strong>
                  {isSaving
                    ? "Writing and checking"
                    : isDirty
                      ? "Changes are not active yet"
                      : confirmation
                        ? confirmation.label
                        : "Saved settings are active"}
                </strong>
                <small>
                  {isSaving
                    ? "Reading the saved record back now"
                    : isDirty
                      ? "Auto-bet continues using the previous values"
                      : confirmation
                        ? `Verified from the saved record at ${formatConfirmationTime(confirmation.updatedAt)}`
                        : "Edit any setting to prepare a change"}
                </small>
              </span>
            </div>
            <button
              className="automation__save-button"
              type="button"
              disabled={isSaving || !isDirty}
              data-dirty={isDirty || undefined}
              onClick={() => void saveDraftSettings()}
            >
              {isSaving ? "Confirming…" : "Save settings"}
            </button>
          </div>

          {settingsError || refreshError ? (
            <p className="automation__error" role="alert">
              {settingsError || refreshError}
            </p>
          ) : null}

          <dl className="automation__rules" aria-label="Automatic betting rules">
            <div>
              <dt>Active cap</dt>
              <dd>{Math.round(rules.maxPrice * 100)}¢</dd>
            </div>
            <div>
              <dt>Order size</dt>
              <dd>{formatCurrency(rules.targetStake)} max</dd>
            </div>
            <div>
              <dt>Rejections</dt>
              <dd>{rules.maxRetries} retries</dd>
            </div>
            <div>
              <dt>Market limit</dt>
              <dd>One bet</dd>
            </div>
          </dl>
        </div>

        <aside className="automation__monitor" aria-label="Automatic betting monitor">
          <div className="automation__monitor-head">
            <div>
              <span className="automation__eyebrow">Live monitor</span>
              <h3>Worker activity</h3>
            </div>
            <span className={`automation__state automation__state--${state}`}>
              <i aria-hidden="true" />
              {stateLabel}
            </span>
          </div>

          <dl className="automation__telemetry">
            <div>
              <dt>Cash</dt>
              <dd>
                {runtime.currentBalance === null
                  ? formatCurrency(accountBalance)
                  : formatCurrency(runtime.currentBalance)}
              </dd>
            </div>
            <div>
              <dt>Events</dt>
              <dd>{runtime.liveEvents}</dd>
            </div>
            <div>
              <dt>Markets</dt>
              <dd>{runtime.monitoredMarkets}</dd>
            </div>
          </dl>

          {runtime.stopReason ? (
            <p className="automation__notice">{runtime.stopReason}</p>
          ) : null}
          {runtime.lastError ? (
            <p className="automation__error" role="alert">
              {runtime.lastError}
            </p>
          ) : null}

          <div className="automation__attempts">
            <div className="automation__attempts-head">
              <span>Latest orders</span>
              <span>{recentAttempts.length ? `${recentAttempts.length} recorded` : "Clear"}</span>
            </div>
            {recentAttempts.length ? (
              <ul>
                {recentAttempts.slice(0, 3).map((attempt) => (
                  <li key={attempt.marketSlug}>
                    <div>
                      <strong>{attempt.title}</strong>
                      <span>
                        {attempt.outcome} · {Math.round(attempt.triggerPrice * 100)}¢ · try {attempt.attempts}
                      </span>
                    </div>
                    <div>
                      <b data-status={attempt.status}>{attempt.status}</b>
                      <time dateTime={attempt.updatedAt}>
                        {formatDate(attempt.updatedAt, true)}
                      </time>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="automation__empty">
                <i aria-hidden="true" />
                <span>
                  <strong>No orders yet</strong>
                  <small>Waiting for a live market to clear the trigger.</small>
                </span>
              </div>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}
