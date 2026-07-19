export type ChartScale = "auto" | "zero" | "symmetric";

export interface ChartDomain {
  minimum: number;
  maximum: number;
}

const PADDING_RATIO = 0.08;
const MINIMUM_PADDING = 0.01;

function paddingFor(value: number): number {
  return Math.max(Math.abs(value) * PADDING_RATIO, MINIMUM_PADDING);
}

/** Builds a readable Y-axis domain for the selected chart scale. */
export function computeChartDomain(
  sourceValues: number[],
  scale: ChartScale,
): ChartDomain {
  const values = sourceValues.filter(Number.isFinite);
  if (!values.length) return { minimum: -1, maximum: 1 };

  const rawMinimum = Math.min(...values);
  const rawMaximum = Math.max(...values);

  if (scale === "symmetric") {
    const bound = Math.max(
      Math.abs(rawMinimum),
      Math.abs(rawMaximum),
      MINIMUM_PADDING,
    );
    const paddedBound = bound * (1 + PADDING_RATIO);
    return { minimum: -paddedBound, maximum: paddedBound };
  }

  if (scale === "zero") {
    if (rawMinimum >= 0) {
      return {
        minimum: 0,
        maximum: rawMaximum + paddingFor(rawMaximum),
      };
    }
    if (rawMaximum <= 0) {
      return {
        minimum: rawMinimum - paddingFor(rawMinimum),
        maximum: 0,
      };
    }

    const padding = (rawMaximum - rawMinimum) * PADDING_RATIO;
    return {
      minimum: rawMinimum - padding,
      maximum: rawMaximum + padding,
    };
  }

  if (rawMinimum === rawMaximum) {
    const padding = paddingFor(rawMinimum);
    return {
      minimum: rawMinimum - padding,
      maximum: rawMaximum + padding,
    };
  }

  const padding = (rawMaximum - rawMinimum) * PADDING_RATIO;
  return {
    minimum: rawMinimum - padding,
    maximum: rawMaximum + padding,
  };
}
