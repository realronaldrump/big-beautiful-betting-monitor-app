"use client";

import { useMemo, useRef, useState } from "react";
import {
  selectChartRange,
  type ChartRange,
} from "@/lib/chart-range";
import {
  computeChartDomain,
  type ChartScale,
} from "@/lib/chart-scale";
import type { PnlPoint } from "@/lib/dashboard-types";
import {
  formatCompactCurrency,
  formatCurrency,
  formatDate,
} from "@/lib/format";

interface PnlChartProps {
  points: PnlPoint[];
}

type ChartMode = "curve" | "bets";

const CHART_RANGES: Array<{ value: ChartRange; label: string }> = [
  { value: "15m", label: "15M" },
  { value: "1h", label: "1H" },
  { value: "6h", label: "6H" },
  { value: "24h", label: "24H" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "all", label: "All" },
];

const SCALE_DESCRIPTIONS: Record<ChartScale, string> = {
  auto: "Fits the Y-axis closely to the active series",
  zero: "Anchors the Y-axis at zero",
  symmetric: "Uses equal gain and loss bounds around zero",
};

const WIDTH = 760;
const HEIGHT = 300;
const PAD_X = 14;
const PAD_TOP = 18;
const PAD_BOTTOM = 26;

export function PnlChart({ points }: PnlChartProps) {
  const [mode, setMode] = useState<ChartMode>("curve");
  const [range, setRange] = useState<ChartRange>("all");
  const [scale, setScale] = useState<ChartScale>("auto");
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const selectedRange = useMemo(
    () => selectChartRange(points, range),
    [points, range],
  );
  const visiblePoints = selectedRange.points;

  const geometry = useMemo(() => {
    const values = [
      selectedRange.startingCumulative,
      ...visiblePoints.map((point) => point.cumulative),
    ];
    const activeValues =
      mode === "curve"
        ? values
        : visiblePoints.map((point) => point.delta);
    const { minimum, maximum } = computeChartDomain(
      activeValues,
      scale,
    );
    const range = maximum - minimum;
    const innerWidth = WIDTH - PAD_X * 2;
    const x = (index: number) =>
      PAD_X + (index / Math.max(values.length - 1, 1)) * innerWidth;
    const y = (value: number) =>
      PAD_TOP + ((maximum - value) / range) * (HEIGHT - PAD_TOP - PAD_BOTTOM);
    const line = values
      .map(
        (value, index) =>
          `${index === 0 ? "M" : "L"}${x(index).toFixed(2)},${y(value).toFixed(2)}`,
      )
      .join(" ");
    const area = `${line} L${x(values.length - 1).toFixed(2)},${y(0).toFixed(2)} L${x(0).toFixed(2)},${y(0).toFixed(2)} Z`;
    return { values, minimum, maximum, x, y, line, area };
  }, [mode, scale, selectedRange.startingCumulative, visiblePoints]);

  if (!points.length) {
    return (
      <section className="chart panel chart--empty" aria-label="Profit and loss chart">
        <span className="empty-glyph" aria-hidden="true">
          ◍
        </span>
        <p>No finished bets yet — the chart starts with your first result.</p>
      </section>
    );
  }

  const { values, minimum, maximum, x, y, line, area } = geometry;
  const zeroY = y(0);
  const zeroVisible = minimum <= 0 && maximum >= 0;
  const finalValue = values[values.length - 1];
  const rising = finalValue >= 0;

  const handlePointer = (event: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * WIDTH;
    const ratio = (px - PAD_X) / (WIDTH - PAD_X * 2);
    const index = Math.round(ratio * (values.length - 1));
    setHoverIndex(Math.max(1, Math.min(values.length - 1, index)));
  };

  const hoverPoint = hoverIndex !== null ? visiblePoints[hoverIndex - 1] : null;
  const barWidth = Math.min(
    ((WIDTH - PAD_X * 2) / Math.max(visiblePoints.length, 1)) * 0.55,
    46,
  );

  return (
    <section className="chart panel" aria-label="Profit and loss chart">
      <header className="chart__head">
        <div>
          <h2 className="panel-title">Profit over time</h2>
          <p className="panel-sub">
            {mode === "curve"
              ? `total from finished bets · ${visiblePoints.length} in range`
              : `profit/loss per finished bet · ${visiblePoints.length} in range`}
          </p>
        </div>
        <div className="mode-toggle" role="tablist" aria-label="Chart mode">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "curve"}
            onClick={() => setMode("curve")}
          >
            Total
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "bets"}
            onClick={() => setMode("bets")}
          >
            Per bet
          </button>
        </div>
      </header>

      <div className="chart__toolbar">
        <div className="chart__range-scroll">
          <div className="range-toggle" role="group" aria-label="Chart date range">
            {CHART_RANGES.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={range === option.value}
                onClick={() => {
                  setRange(option.value);
                  setHoverIndex(null);
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <label className="scale-control" title={SCALE_DESCRIPTIONS[scale]}>
          <span>Scale</span>
          <select
            aria-label="Y-axis scale"
            value={scale}
            onChange={(event) => setScale(event.target.value as ChartScale)}
          >
            <option value="auto">Auto</option>
            <option value="zero">Zero base</option>
            <option value="symmetric">Symmetric</option>
          </select>
        </label>
      </div>

      <div className="chart__stage">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label={`${mode === "curve" ? "Total" : "Per-bet"} profit and loss for the ${range === "all" ? "full history" : range} using ${scale} scale, ending at ${formatCurrency(finalValue, true)}`}
          onPointerMove={handlePointer}
          onPointerLeave={() => setHoverIndex(null)}
        >
          <defs>
            <linearGradient id="chart-area-up" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--lime)" stopOpacity="0.26" />
              <stop offset="100%" stopColor="var(--lime)" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="chart-area-down" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--coral)" stopOpacity="0.22" />
              <stop offset="100%" stopColor="var(--coral)" stopOpacity="0" />
            </linearGradient>
          </defs>

          <line className="chart-grid" x1={PAD_X} x2={WIDTH - PAD_X} y1={y(maximum)} y2={y(maximum)} />
          {zeroVisible ? (
            <line className="chart-grid chart-grid--zero" x1={PAD_X} x2={WIDTH - PAD_X} y1={zeroY} y2={zeroY} />
          ) : null}
          <line className="chart-grid" x1={PAD_X} x2={WIDTH - PAD_X} y1={y(minimum)} y2={y(minimum)} />

          {mode === "curve" ? (
            <g key="curve">
              <path
                className="chart-area"
                d={area}
                fill={`url(#chart-area-${rising ? "up" : "down"})`}
              />
              <path
                className={`chart-line ${rising ? "is-up" : "is-down"}`}
                d={line}
                pathLength={1}
              />
              <circle
                className={`chart-tip ${rising ? "is-up" : "is-down"}`}
                cx={x(values.length - 1)}
                cy={y(finalValue)}
                r="4.5"
              />
            </g>
          ) : (
            <g key="bets">
              {visiblePoints.map((point, index) => {
                const positive = point.delta >= 0;
                const top = positive ? y(point.delta) : zeroY;
                const height = Math.max(Math.abs(y(point.delta) - zeroY), 1.5);
                return (
                  <rect
                    key={point.marketSlug + index}
                    className={`chart-bar ${positive ? "chart-bar--up" : "chart-bar--down"}`}
                    x={x(index + 1) - barWidth / 2}
                    y={top}
                    width={barWidth}
                    height={height}
                    rx="3"
                    style={{ animationDelay: `${index * 45}ms` }}
                  />
                );
              })}
            </g>
          )}

          {hoverIndex !== null && hoverPoint ? (
            <g className="chart-crosshair">
              <line
                x1={x(hoverIndex)}
                x2={x(hoverIndex)}
                y1={PAD_TOP}
                y2={HEIGHT - PAD_BOTTOM}
              />
              <circle
                cx={x(hoverIndex)}
                cy={
                  mode === "curve"
                    ? y(values[hoverIndex])
                    : y(hoverPoint.delta)
                }
                r="4"
              />
            </g>
          ) : null}

          <text className="chart-tag" x={PAD_X} y={y(maximum) - 6}>
            {formatCompactCurrency(maximum)}
          </text>
          <text className="chart-tag" x={PAD_X} y={y(minimum) - 6}>
            {formatCompactCurrency(minimum)}
          </text>
          <text className="chart-tag chart-tag--end" x={WIDTH - PAD_X} y={HEIGHT - 8}>
            {formatDate(visiblePoints[visiblePoints.length - 1].occurredAt)}
          </text>
          <text className="chart-tag" x={PAD_X} y={HEIGHT - 8}>
            {formatDate(visiblePoints[0].occurredAt)}
          </text>
        </svg>

        {hoverIndex !== null && hoverPoint ? (
          <div
            className="chart-tooltip"
            style={
              {
                "--tooltip-x": `${(x(hoverIndex) / WIDTH) * 100}%`,
              } as React.CSSProperties
            }
            role="status"
          >
            <p className="chart-tooltip__title">{hoverPoint.label}</p>
            <p className="chart-tooltip__meta">
              {formatDate(hoverPoint.occurredAt)}
            </p>
            <p className="chart-tooltip__rows">
              <span className={hoverPoint.delta >= 0 ? "is-positive" : "is-negative"}>
                {formatCurrency(hoverPoint.delta, true)} this bet
              </span>
              <span>{formatCurrency(hoverPoint.cumulative, true)} running</span>
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
