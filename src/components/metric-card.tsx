import type { CSSProperties } from "react";
import { AnimatedNumber } from "@/components/animated-number";

export type MetricTone =
  | "neutral"
  | "lime"
  | "coral"
  | "cyan"
  | "amber"
  | "violet";

interface MetricCardProps {
  label: string;
  value: number;
  format: (value: number) => string;
  detail: string;
  tone?: MetricTone;
  /** Optional 0–1 fill for the meter line at the base of the card. */
  meter?: number;
}

export function MetricCard({
  label,
  value,
  format,
  detail,
  tone = "neutral",
  meter,
}: MetricCardProps) {
  return (
    <article className={`metric metric--${tone}`}>
      <p className="metric__label">{label}</p>
      <AnimatedNumber className="metric__value" value={value} format={format} />
      <p className="metric__detail">{detail}</p>
      {meter !== undefined ? (
        <span
          className="metric__meter"
          style={
            {
              "--meter": Math.max(0, Math.min(1, meter)),
            } as CSSProperties
          }
          aria-hidden="true"
        />
      ) : null}
    </article>
  );
}
