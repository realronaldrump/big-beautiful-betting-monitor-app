"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { CSSProperties } from "react";
import { ActivityFeed, type ActivityView } from "@/components/activity-feed";
import { AutomationPanel } from "@/components/automation-panel";
import { CashFlow } from "@/components/cash-flow";
import { EdgePanel } from "@/components/edge-panel";
import { MetricCard } from "@/components/metric-card";
import { PnlChart } from "@/components/pnl-chart";
import { PnlHero } from "@/components/pnl-hero";
import {
  PositionsTable,
  type PositionView,
} from "@/components/positions-table";
import { Scoreboard } from "@/components/scoreboard";
import { SetupBanner } from "@/components/setup-banner";
import { TickerTape } from "@/components/ticker-tape";
import type { DashboardSnapshot } from "@/lib/dashboard-types";
import type { AutomationSnapshot } from "@/automation/store";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";
import { computeOpenBook } from "@/lib/insights";
import { appPath } from "@/lib/app-path";

interface DashboardProps {
  initialSnapshot: DashboardSnapshot;
  initialAutomation: AutomationSnapshot;
  initialError?: string;
}

type SyncState = "demo" | "connecting" | "live" | "reconnecting";

const positionViews: PositionView[] = ["all", "open", "closed"];
const activityViews: ActivityView[] = ["all", "markets", "cash"];
const positionViewLabels: Record<PositionView, string> = {
  all: "All",
  open: "Open",
  closed: "Finished",
};
const activityViewLabels: Record<ActivityView, string> = {
  all: "All",
  markets: "Bets",
  cash: "Cash",
};
const FALLBACK_REFRESH_MS = 15_000;
const RECONCILE_REFRESH_MS = 60_000;

const clockFormat = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function subscribeToClock(onTick: () => void) {
  const timer = setInterval(onTick, 1000);
  return () => clearInterval(timer);
}

function LiveClock() {
  const now = useSyncExternalStore(
    subscribeToClock,
    () => clockFormat.format(new Date()),
    () => "--:--:--",
  );

  return (
    <span className="clock" aria-hidden="true">
      {now}
    </span>
  );
}

function reveal(order: number): CSSProperties {
  return { "--reveal": order } as CSSProperties;
}

export function Dashboard({
  initialSnapshot,
  initialAutomation,
  initialError = "",
}: DashboardProps) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [positionView, setPositionView] = useState<PositionView>("all");
  const [activityView, setActivityView] = useState<ActivityView>("all");
  const [query, setQuery] = useState("");
  const [syncState, setSyncState] = useState<SyncState>(
    initialSnapshot.mode === "live" ? "connecting" : "demo",
  );
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState(initialError);
  const requestInFlight = useRef(false);
  const { summary } = snapshot;

  const updateSnapshot = useCallback(async () => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    setIsSyncing(true);

    try {
      const response = await fetch(appPath("/api/portfolio"), {
        cache: "no-store",
      });
      const payload = (await response.json()) as DashboardSnapshot | { error?: string };
      if (!response.ok || !("summary" in payload)) {
        throw new Error("error" in payload ? payload.error : "Account data could not be updated.");
      }
      setSnapshot(payload);
      setError("");
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Account data could not be updated.");
    } finally {
      requestInFlight.current = false;
      setIsSyncing(false);
    }
  }, []);

  useEffect(() => {
    if (initialSnapshot.mode !== "live") return;

    const source = new EventSource(appPath("/api/portfolio/stream"));
    let updateTimer: ReturnType<typeof setTimeout> | null = null;
    let fallbackTimer: ReturnType<typeof setInterval> | null = null;

    const startFallback = () => {
      if (fallbackTimer) return;
      fallbackTimer = setInterval(updateSnapshot, FALLBACK_REFRESH_MS);
    };

    const stopFallback = () => {
      if (!fallbackTimer) return;
      clearInterval(fallbackTimer);
      fallbackTimer = null;
    };

    source.onopen = () => setSyncState("connecting");
    source.addEventListener("ready", () => {
      stopFallback();
      setSyncState("live");
    });
    source.addEventListener("update", () => {
      if (updateTimer) clearTimeout(updateTimer);
      updateTimer = setTimeout(updateSnapshot, 350);
    });
    source.addEventListener("stream-error", () => {
      setSyncState("reconnecting");
      startFallback();
    });
    source.onerror = () => {
      setSyncState("reconnecting");
      startFallback();
    };

    const reconcileTimer = setInterval(updateSnapshot, RECONCILE_REFRESH_MS);

    return () => {
      source.close();
      if (updateTimer) clearTimeout(updateTimer);
      if (fallbackTimer) clearInterval(fallbackTimer);
      clearInterval(reconcileTimer);
    };
  }, [initialSnapshot.mode, updateSnapshot]);

  const syncLabel =
    syncState === "demo"
      ? "Demo data"
      : syncState === "live"
        ? isSyncing
          ? "Updating"
          : "Live"
        : syncState === "connecting"
          ? "Connecting"
          : "Reconnecting";

  const openBook = computeOpenBook(snapshot.positions);

  return (
    <div className="app">
      <div className="backdrop" aria-hidden="true">
        <span className="backdrop__aurora backdrop__aurora--lime" />
        <span className="backdrop__aurora backdrop__aurora--cyan" />
        <span className="backdrop__aurora backdrop__aurora--violet" />
        <span className="backdrop__grid" />
        <span className="backdrop__noise" />
      </div>

      <header className="topbar">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true">
            BB
          </span>
          <div className="brand__name">
            <span className="brand__kicker">Polymarket US · live execution</span>
            <h1>
              Big Beautiful <em>Betting Monitor</em>
            </h1>
          </div>
        </div>
        <div
          className="live-bets"
          role="status"
          aria-label={`${summary.openMarkets} ${summary.openMarkets === 1 ? "bet is" : "bets are"} currently live`}
        >
          <span className="live-bets__signal" aria-hidden="true" />
          <strong className="live-bets__count">
            {formatNumber(summary.openMarkets, 0)}
          </strong>
          <span className="live-bets__copy" aria-hidden="true">
            <span>Open bets</span>
            <small>awaiting results</small>
          </span>
        </div>
        <div className="status">
          <LiveClock />
          <span className={`sync sync--${syncState}`}>
            <i aria-hidden="true" />
            {syncLabel}
          </span>
          <time className="status__synced" dateTime={snapshot.generatedAt}>
            synced {formatDate(snapshot.generatedAt, true)}
          </time>
        </div>
      </header>

      <TickerTape snapshot={snapshot} />

      <main className="board">
        {error ? (
          <div className="alert" role="alert" style={reveal(0)}>
            <strong>Update failed.</strong> {error}
          </div>
        ) : null}

        {snapshot.setupRequired ? (
          <div className="rise" style={reveal(0)}>
            <SetupBanner />
          </div>
        ) : null}

        <div className="rise" style={reveal(1)}>
          <AutomationPanel
            initialSnapshot={initialAutomation}
            accountBalance={summary.currentBalance}
          />
        </div>

        <div className="hero-grid rise" style={reveal(2)}>
          <PnlHero summary={summary} history={snapshot.pnlHistory} />
          <Scoreboard
            history={snapshot.pnlHistory}
            asOf={snapshot.generatedAt}
          />
        </div>

        <section className="metric-rail rise" style={reveal(3)} aria-label="Account totals">
          <MetricCard
            label="Cash"
            value={summary.currentBalance}
            format={(value) => formatCurrency(value)}
            detail={`${formatCurrency(summary.buyingPower)} available to bet`}
            tone="cyan"
            meter={
              summary.currentBalance > 0
                ? summary.buyingPower / summary.currentBalance
                : 0
            }
          />
          <MetricCard
            label="Finished profit/loss"
            value={summary.realizedPnl}
            format={(value) => formatCurrency(value, true)}
            detail={`${summary.closedMarkets} ${summary.closedMarkets === 1 ? "bet" : "bets"} finished`}
            tone={summary.realizedPnl >= 0 ? "lime" : "coral"}
          />
          <MetricCard
            label="Open profit/loss"
            value={summary.estimatedOpenPnl}
            format={(value) => formatCurrency(value, true)}
            detail={`if ${summary.openMarkets === 1 ? "the open bet were" : `all ${summary.openMarkets} open bets were`} sold now`}
            tone={summary.estimatedOpenPnl >= 0 ? "lime" : "coral"}
          />
          <MetricCard
            label="Money in open bets"
            value={openBook.atRisk}
            format={(value) => formatCurrency(value)}
            detail={`now worth ${formatCurrency(openBook.liveValue)}`}
            tone="neutral"
            meter={openBook.atRisk > 0 ? openBook.liveValue / openBook.maxPayout : 0}
          />
          <MetricCard
            label="If every bet wins"
            value={openBook.maxPayout}
            format={(value) => formatCurrency(value)}
            detail={`you'd profit ${formatCurrency(Math.max(openBook.maxProfit, 0), true)}`}
            tone="neutral"
          />
          <MetricCard
            label="Shares held"
            value={openBook.contracts}
            format={(value) => formatNumber(value, 0)}
            detail="each winning share pays $1"
            tone="neutral"
          />
        </section>

        <div className="analysis-grid rise" style={reveal(4)}>
          <PnlChart points={snapshot.pnlHistory} />
          <div className="side-stack">
            <EdgePanel history={snapshot.pnlHistory} />
            <CashFlow summary={summary} openBook={openBook} />
          </div>
        </div>

        <div className="records-grid rise" style={reveal(5)}>
          <section className="panel" aria-labelledby="positions-heading">
            <div className="records__head">
              <div>
                <h2 className="panel-title" id="positions-heading">
                  Positions
                </h2>
                <p className="panel-sub">
                  {summary.openMarkets} open · {summary.closedMarkets} finished
                </p>
              </div>
              <div className="records__controls">
                <div className="segmented" role="group" aria-label="Filter positions">
                  {positionViews.map((view) => (
                    <button
                      key={view}
                      type="button"
                      aria-pressed={positionView === view}
                      onClick={() => setPositionView(view)}
                    >
                      {positionViewLabels[view]}
                    </button>
                  ))}
                </div>
                <label className="search">
                  <span className="sr-only">Search positions</span>
                  <input
                    type="search"
                    placeholder="Search markets"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </label>
              </div>
            </div>
            <PositionsTable
              positions={snapshot.positions}
              query={query}
              view={positionView}
            />
          </section>

          <section className="panel" aria-labelledby="activity-heading">
            <div className="records__head">
              <div>
                <h2 className="panel-title" id="activity-heading">
                  Activity
                </h2>
                <p className="panel-sub">recent account changes</p>
              </div>
              <div className="segmented" role="group" aria-label="Filter account activity">
                {activityViews.map((view) => (
                  <button
                    key={view}
                    type="button"
                    aria-pressed={activityView === view}
                    onClick={() => setActivityView(view)}
                  >
                    {activityViewLabels[view]}
                  </button>
                ))}
              </div>
            </div>
            <ActivityFeed activities={snapshot.activities} view={activityView} />
          </section>
        </div>

        <footer className="foot rise" style={reveal(6)}>
          <p className="foot__line">
            Local monitor + automatic execution · your API key never leaves this computer
          </p>
          {snapshot.notes.length ? (
            <ul className="foot__notes">
              {snapshot.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          ) : null}
        </footer>
      </main>
    </div>
  );
}
