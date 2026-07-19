import type { PnlPoint } from "@/lib/dashboard-types";

interface SparklineProps {
  points: PnlPoint[];
  id: string;
}

const WIDTH = 320;
const HEIGHT = 64;

/** Tiny cumulative-P&L area glyph used inside the hero card. */
export function Sparkline({ points, id }: SparklineProps) {
  if (points.length < 2) return null;

  const values = [0, ...points.map((point) => point.cumulative)];
  let minimum = Math.min(0, ...values);
  let maximum = Math.max(0, ...values);
  if (maximum === minimum) {
    minimum -= 1;
    maximum += 1;
  }
  const range = maximum - minimum;
  const x = (index: number) => (index / (values.length - 1)) * WIDTH;
  const y = (value: number) => 4 + ((maximum - value) / range) * (HEIGHT - 8);
  const line = values
    .map(
      (value, index) =>
        `${index === 0 ? "M" : "L"}${x(index).toFixed(2)},${y(value).toFixed(2)}`,
    )
    .join(" ");
  const area = `${line} L${WIDTH},${HEIGHT} L0,${HEIGHT} Z`;
  const rising = values[values.length - 1] >= 0;

  return (
    <svg
      className="sparkline"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      data-trend={rising ? "up" : "down"}
    >
      <defs>
        <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path className="sparkline__area" d={area} fill={`url(#${id}-fill)`} />
      <path className="sparkline__line" d={line} pathLength={1} />
    </svg>
  );
}
