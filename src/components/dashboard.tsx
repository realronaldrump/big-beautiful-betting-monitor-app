"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AutomationPanel } from "@/components/automation-panel";
import { BetsExplorer } from "@/components/positions-table";
import { ActivityExplorer } from "@/components/activity-explorer";
import { CashFlow } from "@/components/cash-flow";
import { EdgePanel } from "@/components/edge-panel";
import { MetricCard } from "@/components/metric-card";
import { PnlChart } from "@/components/pnl-chart";
import { PnlHero } from "@/components/pnl-hero";
import { Scoreboard } from "@/components/scoreboard";
import { SetupBanner } from "@/components/setup-banner";
import type { DashboardSnapshot } from "@/lib/dashboard-types";
import type { AutomationSnapshot } from "@/automation/store";
import { formatCurrency, formatDate, formatPercent } from "@/lib/format";
import { computeOpenBook } from "@/lib/insights";
import { appPath } from "@/lib/app-path";
import { createRefreshQueue } from "@/lib/refresh-queue";

interface DashboardProps {
  initialSnapshot: DashboardSnapshot | null;
  initialAutomation: AutomationSnapshot;
  initialError?: string;
}
type View = "bets" | "performance" | "activity";
type SyncState = "demo" | "connecting" | "live" | "reconnecting";
const clockFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Denver",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
function subscribeClock(onTick: () => void) {
  const timer = setInterval(onTick, 1000);
  return () => clearInterval(timer);
}
function LiveClock() {
  const now = useSyncExternalStore(
    subscribeClock,
    () => clockFormat.format(new Date()),
    () => "--:--",
  );
  return (
    <span className="clock" aria-hidden="true">
      {now} MT
    </span>
  );
}

export function Dashboard({
  initialSnapshot,
  initialAutomation,
  initialError = "",
}: DashboardProps) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [view, setView] = useState<View>("bets");
  const [performanceOpened, setPerformanceOpened] = useState(false);
  const [syncState, setSyncState] = useState<SyncState>(
    initialSnapshot?.mode === "demo" ? "demo" : "connecting",
  );
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState(initialError);
  const queueRef = useRef<ReturnType<typeof createRefreshQueue> | null>(null);
  const demo = initialSnapshot?.mode === "demo";
  const initiallyUnavailable = initialSnapshot === null;

  useEffect(() => {
    const queue = createRefreshQueue(async (since, signal) => {
      setIsSyncing(true);
      try {
        const response = await fetch(
          appPath(`/api/portfolio?since=${since}${demo ? "&demo=1" : ""}`),
          {
            cache: "no-store",
            signal: AbortSignal.any([signal, AbortSignal.timeout(65_000)]),
          },
        );
        const payload = (await response.json()) as
          DashboardSnapshot | { error?: string };
        if (!response.ok || !("summary" in payload))
          throw new Error(
            "error" in payload
              ? payload.error
              : "Account data could not be updated.",
          );
        if (!signal.aborted) {
          setSnapshot(payload);
          setError("");
        }
      } catch (cause) {
        if (!signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : "Account data could not be updated.",
          );
      } finally {
        if (!signal.aborted) setIsSyncing(false);
      }
    });
    queueRef.current = queue;
    if (demo)
      return () => {
        queue.stop();
        queueRef.current = null;
      };
    let fallback: ReturnType<typeof setInterval> | null = null;
    const startFallback = () => {
      fallback ??= setInterval(() => void queue.request(Date.now()), 15_000);
    };
    const stopFallback = () => {
      if (fallback) clearInterval(fallback);
      fallback = null;
    };
    startFallback();
    if (initiallyUnavailable) void queue.request(Date.now());
    const source = new EventSource(appPath("/api/portfolio/stream"));
    const eventTime = (event: Event) => {
      try {
        return (
          Date.parse(JSON.parse((event as MessageEvent).data).at) || Date.now()
        );
      } catch {
        return Date.now();
      }
    };
    source.onopen = () => setSyncState("connecting");
    source.addEventListener("ready", (event) => {
      stopFallback();
      setSyncState("live");
      void queue.request(eventTime(event));
    });
    // The queue keeps a trailing refresh even if the event arrives during a fetch.
    source.addEventListener("update", (event) => {
      void queue.request(eventTime(event));
    });
    source.addEventListener("stream-error", () => {
      setSyncState("reconnecting");
      startFallback();
    });
    source.onerror = () => {
      setSyncState("reconnecting");
      startFallback();
    };
    const reconcile = setInterval(() => void queue.request(Date.now()), 60_000);
    return () => {
      source.close();
      stopFallback();
      clearInterval(reconcile);
      queue.stop();
      queueRef.current = null;
    };
  }, [demo, initiallyUnavailable]);

  const label =
    syncState === "demo"
      ? "Demo data"
      : isSyncing
        ? "Updating"
        : syncState === "live"
          ? "Live updates"
          : syncState === "connecting"
            ? "Connecting"
            : "Reconnecting";
  const openBook = snapshot ? computeOpenBook(snapshot.positions) : null;
  const summary = snapshot?.summary;
  const realizedHistory =
    snapshot?.realizedHistory || snapshot?.pnlHistory || [];
  return (
    <div className="app app--explorer">
      <div className="backdrop" aria-hidden="true">
        <span className="backdrop__aurora backdrop__aurora--lime" />
        <span className="backdrop__grid" />
      </div>
      <header className="topbar">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true">
            BB
          </span>
          <div className="brand__name">
            <span className="brand__kicker">Your Polymarket US account</span>
            <h1>
              Big Beautiful <em>Betting Monitor</em>
            </h1>
          </div>
        </div>
        <div className="status">
          <LiveClock />
          <span className={`sync sync--${syncState}`}>
            <i aria-hidden="true" />
            {label}
          </span>
          <button
            className="refresh-button"
            type="button"
            onClick={() => void queueRef.current?.request(Date.now())}
            disabled={isSyncing}
            aria-label="Refresh account"
          >
            ↻
          </button>
        </div>
      </header>
      <main className="board">
        {error ? (
          <div className="alert" role="alert">
            <strong>
              {snapshot ? "Update delayed." : "Account unavailable."}
            </strong>{" "}
            {error} Automatic recovery is active.
            <button
              type="button"
              className="text-button"
              onClick={() => void queueRef.current?.request(Date.now())}
            >
              Retry now
            </button>
          </div>
        ) : null}
        {snapshot?.setupRequired ? <SetupBanner /> : null}
        <AutomationPanel
          initialSnapshot={initialAutomation}
          accountBalance={summary?.currentBalance ?? null}
        />
        {snapshot && summary && openBook ? (
          <>
            <section
              className="account-overview"
              aria-label="Account at a glance"
            >
              <MetricCard
                label="Total profit / loss"
                value={summary.estimatedTotalPnl}
                format={(value) => formatCurrency(value, true)}
                detail="realized + current open P&L, after fees"
                tone={summary.estimatedTotalPnl >= 0 ? "lime" : "coral"}
              />
              <MetricCard
                label="Cash"
                value={summary.currentBalance}
                format={formatCurrency}
                detail={`${formatCurrency(summary.buyingPower)} buying power · collateral excluded`}
                tone="cyan"
              />
              <MetricCard
                label="Win rate"
                value={summary.winRate}
                format={formatPercent}
                detail={`${summary.wins} wins · ${summary.losses} losses · ${summary.pushes} ties`}
                tone="neutral"
              />
              <MetricCard
                label="Open bets"
                value={summary.openMarkets}
                format={(value) => String(Math.round(value))}
                detail={`${formatCurrency(openBook.atRisk)} at risk · ${formatCurrency(openBook.liveValue)} current value`}
                tone="neutral"
              />
            </section>
            <div className="workspace-nav">
              <div role="tablist" aria-label="Dashboard views">
                {(
                  [
                    { value: "bets", label: "Bets" },
                    { value: "performance", label: "Performance" },
                    { value: "activity", label: "Activity" },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.value}
                    id={`tab-${tab.value}`}
                    role="tab"
                    type="button"
                    aria-selected={view === tab.value}
                    aria-controls={`view-${tab.value}`}
                    onClick={() => {
                      setView(tab.value);
                      if (tab.value === "performance")
                        setPerformanceOpened(true);
                    }}
                  >
                    {tab.label}
                    {tab.value === "bets" ? (
                      <span>{snapshot.positions.length}</span>
                    ) : null}
                  </button>
                ))}
              </div>
              <time dateTime={snapshot.generatedAt}>
                Updated {formatDate(snapshot.generatedAt, true)} MT
              </time>
            </div>
            <div
              className="view-panel"
              role="tabpanel"
              id="view-bets"
              aria-labelledby="tab-bets"
              hidden={view !== "bets"}
            >
              <BetsExplorer
                positions={snapshot.positions}
                activities={snapshot.activities}
              />
            </div>
            <div
              className="view-panel"
              role="tabpanel"
              id="view-performance"
              aria-labelledby="tab-performance"
              hidden={view !== "performance"}
            >
              {performanceOpened ? (
                <>
                  <div className="hero-grid">
                    <PnlHero
                      summary={summary}
                      history={realizedHistory}
                      asOf={snapshot.generatedAt}
                    />
                    <Scoreboard
                      history={snapshot.pnlHistory}
                      asOf={snapshot.generatedAt}
                    />
                  </div>
                  <div className="analysis-grid">
                    <PnlChart
                      points={realizedHistory}
                      asOf={snapshot.generatedAt}
                    />
                    <div className="side-stack">
                      <EdgePanel history={snapshot.pnlHistory} />
                      <CashFlow summary={summary} openBook={openBook} />
                    </div>
                  </div>
                </>
              ) : null}
            </div>
            <div
              className="view-panel"
              role="tabpanel"
              id="view-activity"
              aria-labelledby="tab-activity"
              hidden={view !== "activity"}
            >
              <ActivityExplorer activities={snapshot.activities} />
            </div>
            <footer className="foot">
              <p className="foot__line">
                Private account monitor · dates shown in Mountain Time
              </p>
              <ul className="foot__notes">
                {snapshot.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </footer>
          </>
        ) : (
          <section className="panel account-loading" aria-live="polite">
            <span className="section-eyebrow">Connecting to your account</span>
            <h2>{error ? "Waiting for account data" : "Loading your bets"}</h2>
            <p>
              Your actual balance and history will appear when the connection
              recovers.
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
