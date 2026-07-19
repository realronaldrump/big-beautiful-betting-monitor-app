"use client";

import { useMemo, useState } from "react";
import { AnimatedNumber } from "@/components/animated-number";
import { Sparkline } from "@/components/sparkline";
import type { DashboardSummary, PnlPoint } from "@/lib/dashboard-types";
import { formatCurrency, formatPercent } from "@/lib/format";
import { computePnlRange } from "@/lib/pnl-range";
import {
  RECORD_RANGE_OPTIONS,
  type RecordRange,
} from "@/lib/record-range";

interface PnlHeroProps {
  summary: DashboardSummary;
  history: PnlPoint[];
  asOf: string;
}

export function PnlHero({ summary, history, asOf }: PnlHeroProps) {
  const [range, setRange] = useState<RecordRange>("all");
  const selected = useMemo(
    () => computePnlRange(history, range, asOf),
    [asOf, history, range],
  );
  const total = selected.realizedPnl + summary.estimatedOpenPnl;
  const roi = summary.deposits > 0 ? (total / summary.deposits) * 100 : null;
  const trend = total >= 0 ? "up" : "down";

  return (
    <section className="hero panel" aria-label="Total profit and loss">
      <header className="hero__head">
        <div>
          <h2 className="panel-title">Total profit/loss</h2>
          <p className="panel-sub">
            finished bets{range === "all" ? "" : " in range"} + open bets
            if sold now
          </p>
        </div>
        <div className="hero__range-scroll">
          <div
            className="range-toggle hero__range"
            role="group"
            aria-label="Total profit and loss date range"
          >
            {RECORD_RANGE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={range === option.value}
                onClick={() => setRange(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <AnimatedNumber
        className={`hero__figure ${total >= 0 ? "is-positive" : "is-negative"}`}
        value={total}
        format={(value) => formatCurrency(value, true)}
        duration={1100}
      />

      <div className="hero__chips">
        <span className="chip">
          Finished bets{range === "all" ? "" : " in range"}
          <AnimatedNumber
            className={
              selected.realizedPnl >= 0 ? "is-positive" : "is-negative"
            }
            value={selected.realizedPnl}
            format={(value) => formatCurrency(value, true)}
          />
        </span>
        <span className="chip">
          Open if sold now
          <AnimatedNumber
            className={
              summary.estimatedOpenPnl >= 0 ? "is-positive" : "is-negative"
            }
            value={summary.estimatedOpenPnl}
            format={(value) => formatCurrency(value, true)}
          />
        </span>
        {roi !== null ? (
          <span className="chip">
            Return on money added
            <AnimatedNumber
              className={roi >= 0 ? "is-positive" : "is-negative"}
              value={roi}
              format={(value) =>
                `${value >= 0 ? "+" : ""}${formatPercent(value)}`
              }
            />
          </span>
        ) : null}
      </div>

      <div className={`hero__spark hero__spark--${trend}`}>
        <Sparkline points={selected.history} id="hero-spark" />
      </div>
    </section>
  );
}
