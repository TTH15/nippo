"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 0（または from）→ value へカウントアップ表示する小コンポーネント。
 * 報酬・ポイントの加算アニメーションに使用。
 */
export function CountUp({
  value,
  from = 0,
  durationMs = 800,
  format = (n: number) => n.toLocaleString("ja-JP"),
  className,
  prefix = "",
  suffix = "",
}: {
  value: number;
  from?: number;
  durationMs?: number;
  format?: (n: number) => string;
  className?: string;
  prefix?: string;
  suffix?: string;
}) {
  const [display, setDisplay] = useState(from);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const start = performance.now();
    const startVal = from;
    const delta = value - startVal;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      // easeOutCubic
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(startVal + delta * eased);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setDisplay(value);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [value, from, durationMs]);

  return (
    <span className={className}>
      {prefix}
      {format(Math.round(display))}
      {suffix}
    </span>
  );
}
