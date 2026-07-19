import type { CSSProperties, ReactNode } from "react";
import type { DashboardSnapshot } from "@/lib/dashboard-types";
import {
  formatCents,
  formatCompactCurrency,
  formatCurrency,
  formatPercent,
} from "@/lib/format";
import { impliedPrice } from "@/lib/insights";

interface TickerTapeProps {
  snapshot: DashboardSnapshot;
}

interface TickerItem {
  id: string;
  content: ReactNode;
}

function buildItems(snapshot: DashboardSnapshot): TickerItem[] {
  const { summary, positions } = snapshot;
  const items: TickerItem[] = [];

  for (const position of positions.filter((entry) => entry.isOpen)) {
    const price = impliedPrice(position);
    const rising = position.openPnl >= 0;
    items.push({
      id: `pos-${position.marketSlug}`,
      content: (
        <>
          <em data-side={position.outcome.toLowerCase()}>{position.outcome}</em>
          <span className="tick__title">{position.title}</span>
          {price !== null ? <strong>{formatCents(price)}</strong> : null}
          <span className={`tick__delta ${rising ? "is-up" : "is-down"}`}>
            {rising ? "▲" : "▼"} {formatCurrency(Math.abs(position.openPnl))}
          </span>
        </>
      ),
    });
  }

  items.push(
    {
      id: "stat-record",
      content: (
        <>
          <span className="tick__title">Results</span>
          <strong>
            {summary.wins}–{summary.losses}
            {summary.pushes ? `–${summary.pushes}` : ""}
          </strong>
        </>
      ),
    },
    {
      id: "stat-winrate",
      content: (
        <>
          <span className="tick__title">Win rate</span>
          <strong>{formatPercent(summary.winRate)}</strong>
        </>
      ),
    },
    {
      id: "stat-pnl",
      content: (
        <>
          <span className="tick__title">Total profit/loss</span>
          <span
            className={`tick__delta ${summary.estimatedTotalPnl >= 0 ? "is-up" : "is-down"}`}
          >
            {formatCurrency(summary.estimatedTotalPnl, true)}
          </span>
        </>
      ),
    },
    {
      id: "stat-cash",
      content: (
        <>
          <span className="tick__title">Cash</span>
          <strong>{formatCompactCurrency(summary.currentBalance)}</strong>
        </>
      ),
    },
    {
      id: "stat-volume",
      content: (
        <>
          <span className="tick__title">Total bet amount</span>
          <strong>{formatCompactCurrency(summary.tradingVolume)}</strong>
        </>
      ),
    },
  );

  return items;
}

export function TickerTape({ snapshot }: TickerTapeProps) {
  const items = buildItems(snapshot);
  const duration = Math.min(Math.max(items.length * 5, 30), 90);

  const lane = (ariaHidden: boolean) => (
    <div className="ticker__lane" aria-hidden={ariaHidden || undefined}>
      {items.map((item) => (
        <span className="tick" key={item.id}>
          {item.content}
          <span className="tick__gem" aria-hidden="true">
            ✦
          </span>
        </span>
      ))}
    </div>
  );

  return (
    <div className="ticker" role="marquee" aria-label="Live position ticker">
      <div
        className="ticker__track"
        style={{ "--ticker-duration": `${duration}s` } as CSSProperties}
      >
        {lane(false)}
        {lane(true)}
      </div>
    </div>
  );
}
