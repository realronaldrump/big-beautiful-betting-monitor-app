"use client";

import { useEffect, useRef, useState } from "react";

interface AnimatedNumberProps {
  value: number;
  format: (value: number) => string;
  /** Milliseconds for the tween; the boot-up roll uses a little extra. */
  duration?: number;
  className?: string;
}

/**
 * Renders the final value on the server, rolls up from zero after hydration,
 * then tweens between values and flashes on every live update.
 */
export function AnimatedNumber({
  value,
  format,
  duration = 800,
  className,
}: AnimatedNumberProps) {
  const [display, setDisplay] = useState(value);
  const [pulse, setPulse] = useState<{ direction: "up" | "down"; key: number }>({
    direction: "up",
    key: 0,
  });
  const committed = useRef<number | null>(null);
  const frame = useRef(0);

  useEffect(() => {
    const isFirstRun = committed.current === null;
    const from = committed.current ?? 0;
    const to = value;
    committed.current = to;

    if (!isFirstRun && from !== to) {
      setPulse((previous) => ({
        direction: to > from ? "up" : "down",
        key: previous.key + 1,
      }));
    }

    if (from === to) {
      setDisplay(to);
      return;
    }

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDisplay(to);
      return;
    }

    const runtime = isFirstRun ? duration * 1.6 : duration;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min((now - start) / runtime, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(from + (to - from) * eased);
      if (progress < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [value, duration]);

  return (
    <span className={className}>
      <span
        key={pulse.key}
        data-pulse={pulse.key > 0 ? pulse.direction : undefined}
      >
        {format(display)}
      </span>
    </span>
  );
}
