"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AutomationSnapshot } from "@/automation/store";
import { formatCurrency, formatDate } from "@/lib/format";
import { appPath } from "@/lib/app-path";
import {
  normalizeBetSettings,
  settingsMatch,
  type AutomationWrite,
} from "@/lib/automation-settings";
import { workerHealth } from "@/lib/automation-status";

interface AutomationPanelProps {
  initialSnapshot: AutomationSnapshot;
  accountBalance: number | null;
}
const stateLabels = {
  off: "Off",
  starting: "Connecting",
  watching: "Armed",
  stopped: "Reserve protected",
  error: "Reconnecting",
  unavailable: "Worker unavailable",
} as const;
const attemptLabels = {
  submitting: "Submitting",
  retryable: "Will retry",
  submitted: "Awaiting exchange",
  filled: "Filled",
  rejected: "Rejected",
  exhausted: "Retries exhausted",
  ambiguous: "Needs review",
  canceled: "Unfilled",
} as const;
interface SaveConfirmation {
  label: string;
  updatedAt: string;
}

async function readAutomationSnapshot(signal?: AbortSignal) {
  const response = await fetch(appPath("/api/automation"), {
    cache: "no-store",
    signal: AbortSignal.any([
      AbortSignal.timeout(10_000),
      ...(signal ? [signal] : []),
    ]),
  });
  const payload = (await response.json()) as
    AutomationSnapshot | { error?: string };
  if (!response.ok || !("config" in payload))
    throw new Error(
      "error" in payload ? payload.error : "Automation status is unavailable.",
    );
  return payload;
}

export function AutomationPanel({
  initialSnapshot,
  accountBalance,
}: AutomationPanelProps) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [checkedAt, setCheckedAt] = useState(
    Date.parse(
      initialSnapshot.generatedAt || initialSnapshot.runtime.updatedAt,
    ),
  );
  const [floorInput, setFloorInput] = useState(
    initialSnapshot.config.balanceFloor.toFixed(2),
  );
  const [triggerInput, setTriggerInput] = useState(
    String(Math.round(initialSnapshot.config.triggerPrice * 100)),
  );
  const [capInput, setCapInput] = useState(
    String(Math.round(initialSnapshot.config.executionCap * 100)),
  );
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [pendingEnable, setPendingEnable] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  const [refreshError, setRefreshError] = useState("");
  const [confirmation, setConfirmation] = useState<SaveConfirmation | null>(
    null,
  );
  const draftDirtyRef = useRef(false);
  const savingRef = useRef(false);
  const latestRevision = useRef(initialSnapshot.config.revision);
  const latestRuntimeAt = useRef(initialSnapshot.runtime.updatedAt);
  const operation = useRef(0);
  const pendingWrite = useRef<AbortController | null>(null);
  const pollInFlight = useRef(false);
  const parsedFloor = floorInput.trim() ? Number(floorInput) : NaN;
  const parsedTriggerCents = triggerInput.trim() ? Number(triggerInput) : NaN;
  const parsedCapCents = capInput.trim() ? Number(capInput) : NaN;
  const floorFieldDirty =
    !Number.isFinite(parsedFloor) ||
    Math.abs(parsedFloor - snapshot.config.balanceFloor) >= 0.001;
  const triggerFieldDirty =
    parsedTriggerCents !== Math.round(snapshot.config.triggerPrice * 100);
  const capFieldDirty =
    parsedCapCents !== Math.round(snapshot.config.executionCap * 100);
  const maxConfigurableCapCents = Math.round(
    snapshot.rules.maxConfigurablePrice * 100,
  );
  const maxTriggerCents = Math.max(
    1,
    Math.min(
      Number.isFinite(parsedCapCents)
        ? parsedCapCents
        : maxConfigurableCapCents,
      Math.round(snapshot.rules.maxTriggerPrice * 100),
    ),
  );

  const applySnapshot = useCallback((payload: AutomationSnapshot) => {
    if (
      payload.config.revision < latestRevision.current ||
      (payload.config.revision === latestRevision.current &&
        payload.runtime.updatedAt < latestRuntimeAt.current)
    )
      return false;
    latestRevision.current = payload.config.revision;
    latestRuntimeAt.current = payload.runtime.updatedAt;
    setSnapshot(payload);
    if (!draftDirtyRef.current && !savingRef.current) {
      setFloorInput(payload.config.balanceFloor.toFixed(2));
      setTriggerInput(String(Math.round(payload.config.triggerPrice * 100)));
      setCapInput(String(Math.round(payload.config.executionCap * 100)));
    }
    setConfirmation((current) =>
      current?.updatedAt === payload.config.updatedAt ? current : null,
    );
    return true;
  }, []);
  const refresh = useCallback(async () => {
    if (pollInFlight.current) return;
    pollInFlight.current = true;
    try {
      applySnapshot(await readAutomationSnapshot());
      setRefreshError("");
    } catch (error) {
      setRefreshError(
        error instanceof Error
          ? error.message
          : "Automation status is unavailable.",
      );
    } finally {
      pollInFlight.current = false;
    }
  }, [applySnapshot]);
  useEffect(() => {
    const timer = setInterval(() => {
      setCheckedAt(Date.now());
      void refresh();
    }, 2_000);
    return () => {
      clearInterval(timer);
      operation.current += 1;
      pendingWrite.current?.abort();
    };
  }, [refresh]);

  async function writeAndConfirm(
    mutation: AutomationWrite,
    signal: AbortSignal,
  ) {
    const response = await fetch(appPath("/api/automation"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-BBBM-Action": "automation-config",
      },
      body: JSON.stringify(mutation),
      signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    });
    const payload = (await response.json()) as
      AutomationSnapshot | { error?: string };
    if (!response.ok || !("config" in payload))
      throw new Error(
        "error" in payload ? payload.error : "Settings could not be saved.",
      );
    const confirmed = await readAutomationSnapshot(signal);
    if (
      !settingsMatch(confirmed.config, mutation) ||
      (mutation.action !== "disable" &&
        confirmed.config.revision !== payload.config.revision)
    )
      throw new Error(
        "Settings changed again before confirmation. Review the current values.",
      );
    return confirmed;
  }

  function markDraftChanged(floor: string, trigger: string, cap: string) {
    const dirty =
      !floor.trim() ||
      !trigger.trim() ||
      !cap.trim() ||
      Number(floor) !== snapshot.config.balanceFloor ||
      Number(trigger) !== Math.round(snapshot.config.triggerPrice * 100) ||
      Number(cap) !== Math.round(snapshot.config.executionCap * 100);
    draftDirtyRef.current = dirty;
    setIsDirty(dirty);
    setSettingsError("");
    if (dirty) setConfirmation(null);
  }
  async function performWrite(mutation: AutomationWrite) {
    const ownOperation = ++operation.current;
    pendingWrite.current?.abort();
    const controller = new AbortController();
    pendingWrite.current = controller;
    const stopping = mutation.action === "disable";
    savingRef.current = !stopping;
    setIsSaving(!stopping);
    setIsStopping(stopping);
    setPendingEnable(mutation.action === "enable");
    setSettingsError("");
    try {
      const confirmed = await writeAndConfirm(mutation, controller.signal);
      if (operation.current !== ownOperation) return;
      if (mutation.action === "settings") {
        draftDirtyRef.current = false;
        setIsDirty(false);
        setFloorInput(confirmed.config.balanceFloor.toFixed(2));
        setTriggerInput(
          String(Math.round(confirmed.config.triggerPrice * 100)),
        );
        setCapInput(String(Math.round(confirmed.config.executionCap * 100)));
      }
      applySnapshot(confirmed);
      setRefreshError("");
      setConfirmation({
        label:
          mutation.action === "settings"
            ? "Bet settings locked in"
            : `Auto-bet turned ${mutation.action === "enable" ? "on" : "off"}`,
        updatedAt: confirmed.config.updatedAt,
      });
    } catch (error) {
      if (operation.current === ownOperation) {
        setSettingsError(
          error instanceof Error
            ? error.message
            : "Settings could not be saved.",
        );
        void refresh();
      }
    } finally {
      if (operation.current === ownOperation) {
        savingRef.current = false;
        setIsSaving(false);
        setIsStopping(false);
        setPendingEnable(false);
        pendingWrite.current = null;
      }
    }
  }
  async function saveDraftSettings() {
    if (savingRef.current || isStopping) return;
    try {
      const settings = normalizeBetSettings({
        balanceFloor: parsedFloor,
        triggerPrice: parsedTriggerCents / 100,
        executionCap: parsedCapCents / 100,
      });
      await performWrite({
        action: "settings",
        expectedRevision: snapshot.config.revision,
        ...settings,
      });
    } catch (error) {
      setSettingsError(
        error instanceof Error ? error.message : "Enter valid bet settings.",
      );
    }
  }
  async function toggleAutomation() {
    if (snapshot.config.enabled || pendingEnable) {
      await performWrite({ action: "disable" });
      return;
    }
    if (draftDirtyRef.current) {
      setSettingsError(
        "Save your pending settings before turning Auto-bet on.",
      );
      return;
    }
    await performWrite({
      action: "enable",
      expectedRevision: snapshot.config.revision,
    });
  }

  const { config, runtime, rules, recentAttempts } = snapshot;
  const health = workerHealth(snapshot, checkedAt);
  const state = health.state;
  const stateLabel = isStopping
    ? "Stopping"
    : pendingEnable
      ? "Enabling"
      : stateLabels[state];
  const armed = state === "watching";
  const cash =
    !config.enabled || !health.alive || runtime.currentBalance === null
      ? accountBalance
      : runtime.currentBalance;
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
          <p>
            {Math.round(config.triggerPrice * 100)}¢ entry ·{" "}
            {Math.round(config.executionCap * 100)}¢ cap ·{" "}
            {formatCurrency(config.balanceFloor)} cash reserve
          </p>
        </div>

        <div className="automation__master">
          <span>Master switch</span>
          <button
            className="automation__switch"
            type="button"
            role="switch"
            aria-checked={config.enabled}
            disabled={
              isStopping ||
              (!config.enabled &&
                !pendingEnable &&
                (isSaving || snapshot.credentialsConfigured === false))
            }
            onClick={() => void toggleAutomation()}
          >
            <span aria-hidden="true" />
            {isStopping
              ? "Stopping…"
              : config.enabled || pendingEnable
                ? "Turn off"
                : "Turn on"}
          </button>
        </div>
      </header>

      {state === "unavailable" ? (
        <p className="automation__error" role="alert">
          The worker has stopped reporting. Auto-bet activity cannot be
          confirmed.
        </p>
      ) : null}
      {settingsError || refreshError ? (
        <p className="automation__error" role="alert">
          {settingsError || refreshError}
        </p>
      ) : null}
      <details className="automation__details">
        <summary>
          Settings &amp; worker activity{" "}
          <span>{isDirty ? "Unsaved changes" : "Manage"}</span>
        </summary>
        <div className="automation__body">
          <div className="automation__control-deck">
            <div className="automation__section-head">
              <div>
                <span className="automation__eyebrow">Live bet settings</span>
                <h3>Entry, cap, and reserve</h3>
              </div>
              <span
                className="automation__draft-badge"
                data-dirty={isDirty || undefined}
              >
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
                    disabled={isSaving || isStopping}
                    data-dirty={triggerFieldDirty || undefined}
                    aria-describedby="trigger-price-note"
                    onChange={(event) => {
                      setTriggerInput(event.target.value);
                      markDraftChanged(
                        floorInput,
                        event.target.value,
                        capInput,
                      );
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
                    disabled={isSaving || isStopping}
                    data-dirty={capFieldDirty || undefined}
                    aria-describedby="execution-cap-note"
                    onChange={(event) => {
                      setCapInput(event.target.value);
                      markDraftChanged(
                        floorInput,
                        triggerInput,
                        event.target.value,
                      );
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
                    disabled={isSaving || isStopping}
                    data-dirty={floorFieldDirty || undefined}
                    onChange={(event) => {
                      setFloorInput(event.target.value);
                      markDraftChanged(
                        event.target.value,
                        triggerInput,
                        capInput,
                      );
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void saveDraftSettings();
                      }
                    }}
                  />
                </div>
                <p>Protected after contract cost and trading fees.</p>
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
                          ? `Verified from the saved record at ${formatDate(confirmation.updatedAt, true)}`
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

            <dl
              className="automation__rules"
              aria-label="Automatic betting rules"
            >
              <div>
                <dt>Active cap</dt>
                <dd>{Math.round(rules.maxPrice * 100)}¢</dd>
              </div>
              <div>
                <dt>Contract value</dt>
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

          <aside
            className="automation__monitor"
            aria-label="Automatic betting monitor"
          >
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
                <dd>{cash === null ? "—" : formatCurrency(cash)}</dd>
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
                <span>
                  {recentAttempts.length
                    ? `${recentAttempts.length} recorded`
                    : "Clear"}
                </span>
              </div>
              {recentAttempts.length ? (
                <ul>
                  {recentAttempts.slice(0, 3).map((attempt) => (
                    <li key={attempt.marketSlug}>
                      <div>
                        <strong>{attempt.title}</strong>
                        <span>
                          {attempt.outcome} ·{" "}
                          {Math.round(attempt.triggerPrice * 100)}¢ · try{" "}
                          {attempt.attempts}
                        </span>
                        {attempt.lastError ? (
                          <small className="automation__attempt-note">
                            {attempt.lastError}
                          </small>
                        ) : null}
                      </div>
                      <div>
                        <b data-status={attempt.status}>
                          {attemptLabels[attempt.status]}
                        </b>
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
                    <small>
                      Waiting for a live market to clear the trigger.
                    </small>
                  </span>
                </div>
              )}
            </div>
          </aside>
        </div>
      </details>
    </section>
  );
}
