"use client";

import { useEffect, useMemo, useState } from "react";
import type { PnlPoint } from "@/lib/dashboard-types";
import { formatPercent } from "@/lib/format";
import { computeForm, computeStreak } from "@/lib/insights";
import {
  computeRecordStats,
  selectRecordRange,
  type RecordRange,
} from "@/lib/record-range";

interface ScoreboardProps {
  history: PnlPoint[];
  asOf: string;
}

const RECORD_RANGES: Array<{ value: RecordRange; label: string }> = [
  { value: "1h", label: "1H" },
  { value: "24h", label: "24H" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "all", label: "All" },
];

const RADIUS = 54;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function Scoreboard({ history, asOf }: ScoreboardProps) {
  const [armed, setArmed] = useState(false);
  const [range, setRange] = useState<RecordRange>("all");
  const visibleHistory = useMemo(
    () => selectRecordRange(history, range, asOf),
    [asOf, history, range],
  );
  const record = useMemo(
    () => computeRecordStats(visibleHistory),
    [visibleHistory],
  );
  const streak = computeStreak(visibleHistory);
  const form = computeForm(visibleHistory);
  const sweep = CIRCUMFERENCE * (1 - record.winRate / 100);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setArmed(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <section className="scoreboard panel" aria-label="Win and loss record">
      <header className="scoreboard__head">
        <div>
        <h2 className="panel-title">Results</h2>
          <p className="panel-sub">
            {record.settledMarkets} {record.settledMarkets === 1 ? "bet" : "bets"} finished in range
          </p>
        </div>
        <div className="scoreboard__range-scroll">
          <div className="range-toggle scoreboard__range" role="group" aria-label="Record date range">
            {RECORD_RANGES.map((option) => (
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

      <div className="scoreboard__body">
        <div
          className="scoreboard__tally"
          aria-label={`${record.wins} wins, ${record.losses} losses, ${record.pushes} ties or refunds`}
        >
          <div className="tally tally--win">
            <strong>{record.wins}</strong>
            <span>Wins</span>
          </div>
          <div className="tally tally--loss">
            <strong>{record.losses}</strong>
            <span>Losses</span>
          </div>
          <div className="tally tally--push">
            <strong>{record.pushes}</strong>
            <span>Ties</span>
          </div>
        </div>

        <div className="scoreboard__gauge">
          <svg viewBox="0 0 128 128" role="img" aria-label={`Win rate ${formatPercent(record.winRate)}`}>
            <circle className="gauge__track" cx="64" cy="64" r={RADIUS} />
            <circle
              className="gauge__fill"
              cx="64"
              cy="64"
              r={RADIUS}
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={armed ? sweep : CIRCUMFERENCE}
            />
          </svg>
          <div className="gauge__readout">
            <strong>{formatPercent(record.winRate)}</strong>
            <span>win rate</span>
          </div>
        </div>
      </div>

      <footer className="scoreboard__foot">
        <div
          className={`streak streak--${streak.kind}`}
          aria-label={
            streak.kind === "none"
              ? "No active streak"
              : `${streak.length} ${streak.kind} streak`
          }
        >
          {streak.kind === "none" ? (
            <span className="streak__label">No streak yet</span>
          ) : (
            <>
              <span className="streak__flame" aria-hidden="true">
                {streak.kind === "win" ? "◆" : "◇"}
              </span>
              <strong>
                {streak.kind === "win" ? "W" : "L"}
                {streak.length}
              </strong>
              <span className="streak__label">
                {streak.kind === "win" ? "winning streak" : "losing streak"}
              </span>
            </>
          )}
        </div>
        {form.length ? (
          <div className="form-guide" aria-label="Last finished results, oldest to newest">
            {form.map((result, index) => (
              <span
                key={index}
                className={`form-dot form-dot--${result}`}
                title={result}
              />
            ))}
          </div>
        ) : null}
      </footer>
    </section>
  );
}
