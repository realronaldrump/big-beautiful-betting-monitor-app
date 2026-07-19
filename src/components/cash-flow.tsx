import type { CSSProperties } from "react";
import type { DashboardSummary } from "@/lib/dashboard-types";
import { formatCompactCurrency, formatCurrency } from "@/lib/format";
import type { OpenBookStats } from "@/lib/insights";

interface CashFlowProps {
  summary: DashboardSummary;
  openBook: OpenBookStats;
}

interface FlowRow {
  key: string;
  label: string;
  amount: number;
  direction: "in" | "out";
  tone: "cyan" | "coral" | "lime";
}

export function CashFlow({ summary, openBook }: CashFlowProps) {
  const rows: FlowRow[] = [
    {
      key: "deposits",
      label: "Deposits",
      amount: summary.deposits,
      direction: "in",
      tone: "cyan",
    },
    {
      key: "rewards",
      label: "Rewards & rebates",
      amount: summary.rewardsAndRebates,
      direction: summary.rewardsAndRebates >= 0 ? "in" : "out",
      tone: "lime",
    },
    {
      key: "withdrawals",
      label: "Withdrawals",
      amount: -summary.withdrawals,
      direction: "out",
      tone: "coral",
    },
  ];
  const scale = Math.max(...rows.map((row) => Math.abs(row.amount)), 1);

  const exposureTotal = summary.currentBalance + openBook.atRisk;
  const cashShare = exposureTotal > 0 ? summary.currentBalance / exposureTotal : 1;

  return (
    <section className="flow panel" aria-label="Cash flow">
      <header className="flow__head">
        <h2 className="panel-title">Money map</h2>
        <p className="panel-sub">where every dollar sits</p>
      </header>

      <ul className="flow__rows">
        {rows.map((row, index) => (
          <li className="flow-row" key={row.key}>
            <span className="flow-row__label">{row.label}</span>
            <span className="flow-row__track" aria-hidden="true">
              <span
                className={`flow-row__fill flow-row__fill--${row.tone}`}
                style={
                  {
                    "--fill": Math.abs(row.amount) / scale,
                    animationDelay: `${200 + index * 120}ms`,
                  } as CSSProperties
                }
              />
            </span>
            <span
              className={`flow-row__amount ${
                row.amount > 0 ? "is-positive" : row.amount < 0 ? "is-negative" : ""
              }`}
            >
              {formatCurrency(row.amount, true)}
            </span>
          </li>
        ))}
      </ul>

      <p className="flow__net">
        <span>Net added to account</span>
        <strong
          className={summary.netAccountInflows >= 0 ? "is-positive" : "is-negative"}
        >
          {formatCurrency(summary.netAccountInflows, true)}
        </strong>
      </p>

      <div className="flow__exposure">
        <p className="flow__exposure-title">Where your money is now</p>
        <div
          className="exposure-meter"
          style={{ "--cash-share": cashShare } as CSSProperties}
          role="img"
          aria-label={`${formatCurrency(summary.currentBalance)} in cash, ${formatCurrency(openBook.atRisk)} riding on open bets`}
        >
          <span className="exposure-meter__cash" />
          <span className="exposure-meter__risk" />
        </div>
        <div className="exposure-legend">
          <span>
            <i className="dot dot--cyan" aria-hidden="true" />
            Cash {formatCompactCurrency(summary.currentBalance)}
          </span>
          <span>
            <i className="dot dot--amber" aria-hidden="true" />
            In open bets {formatCompactCurrency(openBook.atRisk)}
          </span>
        </div>
      </div>

      <p className="flow__foot">
        {formatCompactCurrency(summary.tradingVolume)} bet in total ·{" "}
        {formatCurrency(summary.unsettledFunds)} waiting to clear
      </p>
    </section>
  );
}
