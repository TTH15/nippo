"use client";

import { useEffect, useRef, useState } from "react";

/** easeOutCubic（既定）: 序盤速く終盤ゆっくり */
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
/** wave: ゆっくり始まり・中盤で速く・終盤ほどゆっくり（後半に強い減速＝波形） */
export const easeWave = (t: number) => {
  const smooth = t * t * t * (t * (t * 6 - 15) + 10); // smootherstep（slow-fast-slow）
  const slowTail = 1 - Math.pow(1 - t, 4); // easeOutQuart（終盤を更に減速）
  return smooth * 0.45 + slowTail * 0.55;
};

/**
 * 0（または from）→ value へカウントアップ表示する小コンポーネント。
 * 報酬・ポイントの加算アニメーションに使用。
 * pop=true で、カウントアップ進行に同期して数字が膨張→反動→収束する（JS駆動・確実に動く）。
 * ease で速度カーブを差し替え可能（既定 easeOutCubic / 波形は easeWave）。
 */
export function CountUp({
  value,
  from = 0,
  durationMs = 800,
  format = (n: number) => n.toLocaleString("ja-JP"),
  className,
  style,
  prefix = "",
  suffix = "",
  pop = false,
  popScale = 0.3,
  ease = easeOutCubic,
}: {
  value: number;
  from?: number;
  durationMs?: number;
  format?: (n: number) => string;
  className?: string;
  style?: React.CSSProperties;
  prefix?: string;
  suffix?: string;
  /** カウントアップ中に数字が膨張→反動→収束する */
  pop?: boolean;
  /** 膨張の最大量（0.3 = 最大 +30%） */
  popScale?: number;
  /** 速度カーブ。t∈[0,1] → 進捗∈[0,1] */
  ease?: (t: number) => number;
}) {
  const [display, setDisplay] = useState(from);
  const [scale, setScale] = useState(1);
  const rafRef = useRef<number | null>(null);
  const easeRef = useRef(ease);
  easeRef.current = ease;

  useEffect(() => {
    const start = performance.now();
    const startVal = from;
    const delta = value - startVal;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = easeRef.current(t);
      setDisplay(startVal + delta * eased);
      // 減衰チャープ: 総数は控えめ(6ローブ=3往復)、開始は粗く・終盤だけ細かく、振れ幅は減衰。
      // 位相 = π·(t + 5t²) → 瞬時周波数 1→11。t=1 で 6π=偶数ローブ(縮小)→収束。
      if (pop) setScale(1 + popScale * Math.exp(-2.2 * t) * Math.sin(Math.PI * t * (1 + 5 * t)));
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setDisplay(value);
        if (pop) setScale(1);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [value, from, durationMs, pop, popScale]);

  const mergedStyle: React.CSSProperties = pop
    ? { display: "inline-block", transform: `scale(${scale})`, transformOrigin: "center", willChange: "transform", ...style }
    : style ?? {};

  return (
    <span className={className} style={mergedStyle}>
      {prefix}
      {format(Math.round(display))}
      {suffix}
    </span>
  );
}
