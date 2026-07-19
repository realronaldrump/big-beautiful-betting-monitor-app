import { AnimatedNumber } from "@/components/animated-number";
import { Sparkline } from "@/components/sparkline";
import type { DashboardSummary, PnlPoint } from "@/lib/dashboard-types";
import { formatCurrency, formatPercent } from "@/lib/format";
import { returnOnDeposits } from "@/lib/insights";

interface PnlHeroProps {
  summary: DashboardSummary;
  history: PnlPoint[];
}

export function PnlHero({ summary, history }: PnlHeroProps) {
  const total = summary.estimatedTotalPnl;
  const roi = returnOnDeposits(summary);
  const trend = total >= 0 ? "up" : "down";

  return (
    <section className="hero panel" aria-label="Total profit and loss">
      <header className="hero__head">
        <h2 className="panel-title">Total profit/loss</h2>
        <p className="panel-sub">finished bets + open bets if sold now</p>
      </header>

      <AnimatedNumber
        className={`hero__figure ${total >= 0 ? "is-positive" : "is-negative"}`}
        value={total}
        format={(value) => formatCurrency(value, true)}
        duration={1100}
      />

      <div className="hero__chips">
        <span className="chip">
          Finished bets
          <AnimatedNumber
            className={summary.realizedPnl >= 0 ? "is-positive" : "is-negative"}
            value={summary.realizedPnl}
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
        <Sparkline points={history} id="hero-spark" />
      </div>
    </section>
  );
}
