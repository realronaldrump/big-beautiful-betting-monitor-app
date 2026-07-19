import type { CSSProperties } from "react";
import { AnimatedNumber } from "@/components/animated-number";
import type { PositionRow } from "@/lib/dashboard-types";
import {
  formatCents,
  formatCurrency,
  formatDate,
  formatNumber,
} from "@/lib/format";
import { entryPrice, impliedPrice } from "@/lib/insights";

export type PositionView = "all" | "open" | "closed";

interface PositionsTableProps {
  positions: PositionRow[];
  query: string;
  view: PositionView;
}

const RESULT_LABELS: Record<PositionRow["result"], string> = {
  win: "Win",
  loss: "Loss",
  push: "Tie / refund",
  open: "Open",
};

function PriceTrack({ position }: { position: PositionRow }) {
  const now = impliedPrice(position);
  const entry = entryPrice(position);

  if (!position.isOpen || now === null || entry === null) {
    return (
      <div className="price-cell price-cell--settled" role="cell" data-label="Price">
        <span>finished {formatDate(position.updatedAt)}</span>
      </div>
    );
  }

  const ahead = now >= entry;
  return (
    <div className="price-cell" role="cell" data-label="Price">
      <p className="price-cell__readout">
        <strong>{formatCents(now)}</strong>
        <span>
          from {formatCents(entry)} {ahead ? "▲" : "▼"}
        </span>
      </p>
      <span
        className={`price-track ${ahead ? "is-ahead" : "is-behind"}`}
        style={
          {
            "--now": Math.max(0, Math.min(1, now)),
            "--entry": Math.max(0, Math.min(1, entry)),
          } as CSSProperties
        }
        aria-hidden="true"
      >
        <span className="price-track__fill" />
        <span className="price-track__entry" />
      </span>
    </div>
  );
}

export function PositionsTable({ positions, query, view }: PositionsTableProps) {
  const normalizedQuery = query.trim().toLowerCase();
  const visiblePositions = positions.filter((position) => {
    const matchesView =
      view === "all" || (view === "open" ? position.isOpen : !position.isOpen);
    const matchesQuery =
      !normalizedQuery ||
      position.title.toLowerCase().includes(normalizedQuery) ||
      position.outcome.toLowerCase().includes(normalizedQuery);
    return matchesView && matchesQuery;
  });

  if (!visiblePositions.length) {
    return (
      <div className="table-empty">
        <span className="empty-glyph" aria-hidden="true">
          ◎
        </span>
        <p>No positions match this view.</p>
      </div>
    );
  }

  return (
    <div className="positions" role="table" aria-label="Polymarket positions">
      <div className="positions__head" role="row">
        <span role="columnheader">Market</span>
        <span role="columnheader">Result</span>
        <span role="columnheader">Price / share</span>
        <span role="columnheader">Current value</span>
        <span role="columnheader">Profit/loss</span>
      </div>
      {visiblePositions.map((position, index) => {
        const displayedPnl = position.isOpen
          ? position.openPnl
          : position.realizedPnl;
        return (
          <article
            className="position-row"
            role="row"
            key={position.marketSlug}
            style={{ "--row-index": index } as CSSProperties}
          >
            <div className="position-cell" role="cell">
              <span
                className={`side-chip side-chip--${position.outcome.toLowerCase() === "no" ? "no" : "yes"}`}
              >
                {position.outcome}
              </span>
              <div className="position-cell__copy">
                <h3>{position.title}</h3>
                <p>
                  {formatNumber(Math.abs(position.quantity), 2)} shares ·{" "}
                  {formatDate(position.updatedAt)}
                </p>
              </div>
            </div>

            <div role="cell" data-label="Result">
              <span className={`result-tag result-tag--${position.result}`}>
                {position.result === "open" ? (
                  <i className="result-tag__pulse" aria-hidden="true" />
                ) : null}
                {RESULT_LABELS[position.result]}
              </span>
            </div>

            <PriceTrack position={position} />

            <div className="value-cell" role="cell" data-label="Value">
              {position.isOpen ? (
                <>
                  <AnimatedNumber
                    className="value-cell__value"
                    value={position.marketValue}
                    format={(value) => formatCurrency(value)}
                  />
                  <span>{formatCurrency(position.costBasis)} invested</span>
                </>
              ) : (
                <span className="value-cell__muted">—</span>
              )}
            </div>

            <div
              className={`pnl-cell ${displayedPnl >= 0 ? "is-positive" : "is-negative"}`}
              role="cell"
              data-label="Profit/loss"
            >
              <AnimatedNumber
                className="pnl-cell__value"
                value={displayedPnl}
                format={(value) => formatCurrency(value, true)}
              />
              <span>{position.isOpen ? "if sold now" : "final"}</span>
            </div>
          </article>
        );
      })}
    </div>
  );
}
