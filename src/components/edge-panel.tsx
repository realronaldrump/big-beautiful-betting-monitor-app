import type { CSSProperties } from "react";
import type { PnlPoint } from "@/lib/dashboard-types";
import { formatCurrency, formatMultiple } from "@/lib/format";
import { computeEdge } from "@/lib/insights";

interface EdgePanelProps {
  history: PnlPoint[];
}

export function EdgePanel({ history }: EdgePanelProps) {
  const edge = computeEdge(history);
  const grossTotal = edge.grossWins + edge.grossLosses;
  const winShare = grossTotal > 0 ? edge.grossWins / grossTotal : 0.5;
  const averageScale = Math.max(edge.averageWin, edge.averageLoss, 1);

  return (
    <section className="edge panel" aria-label="Win and loss dollars">
      <header className="edge__head">
        <h2 className="panel-title">Win/loss dollars</h2>
        <p className="panel-sub">what wins earned compared with losses</p>
      </header>

      <div className="edge__factor">
        <div>
          <strong className={edge.profitFactor === null || edge.profitFactor >= 1 ? "is-positive" : "is-negative"}>
            {edge.profitFactor === null
              ? history.length
                ? "∞"
                : "—"
              : formatMultiple(edge.profitFactor)}
          </strong>
          <span>won per $1 lost</span>
        </div>
        <p>
          {formatCurrency(edge.grossWins)} won vs{" "}
          {formatCurrency(edge.grossLosses)} lost
        </p>
      </div>

      <div
        className="edge__split"
        style={{ "--win-share": winShare } as CSSProperties}
        aria-hidden="true"
      >
        <span className="edge__split-win" />
        <span className="edge__split-loss" />
      </div>

      <dl className="edge__pair">
        <div className="edge__stat">
          <dt>Avg win</dt>
          <dd className="is-positive">{formatCurrency(edge.averageWin, true)}</dd>
          <span
            className="edge__bar edge__bar--win"
            style={{ "--fill": edge.averageWin / averageScale } as CSSProperties}
            aria-hidden="true"
          />
        </div>
        <div className="edge__stat">
          <dt>Avg loss</dt>
          <dd className="is-negative">
            {formatCurrency(-edge.averageLoss, true)}
          </dd>
          <span
            className="edge__bar edge__bar--loss"
            style={{ "--fill": edge.averageLoss / averageScale } as CSSProperties}
            aria-hidden="true"
          />
        </div>
      </dl>

      <ul className="edge__extremes">
        {edge.bestPoint ? (
          <li>
            <span className="edge__badge edge__badge--best">Best</span>
            <p>{edge.bestPoint.label}</p>
            <strong className="is-positive">
              {formatCurrency(edge.bestPoint.delta, true)}
            </strong>
          </li>
        ) : null}
        {edge.worstPoint && edge.worstPoint.delta < 0 ? (
          <li>
            <span className="edge__badge edge__badge--worst">Worst</span>
            <p>{edge.worstPoint.label}</p>
            <strong className="is-negative">
              {formatCurrency(edge.worstPoint.delta, true)}
            </strong>
          </li>
        ) : null}
      </ul>

      <p className="edge__foot">
        {history.length
          ? `${formatCurrency(edge.edgePerBet, true)} average profit/loss per finished bet`
          : "Finish a bet to see these stats."}
      </p>
    </section>
  );
}
