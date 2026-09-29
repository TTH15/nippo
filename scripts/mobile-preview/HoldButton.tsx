import { useEffect, useRef, useState } from "react";
import { HOLD_MS } from "../../apps/mobile/src/components/hold-settings";

// PunchButtonと同じ800ms・途中取消。WebではSVGでnativeの円周ゲージを再現する。
export function HoldButton({ mode, onTriggered }: { mode: "start" | "end"; onTriggered: () => void }) {
  const [progress, setProgress] = useState(0);
  const frame = useRef(0), start = useRef<number | null>(null);
  const callback = useRef(onTriggered); callback.current = onTriggered;
  function cancel() { cancelAnimationFrame(frame.current); start.current = null; setProgress(0); }
  useEffect(() => {
    const hidden = () => { if (document.hidden) cancel(); };
    document.addEventListener('visibilitychange', hidden); window.addEventListener('blur', cancel);
    return () => { cancelAnimationFrame(frame.current); document.removeEventListener('visibilitychange', hidden); window.removeEventListener('blur', cancel); };
  }, []);
  function begin() {
    if (start.current !== null) return;
    start.current = performance.now();
    const tick = (now: number) => {
      if (start.current === null) return;
      const value = Math.min(1, (now - start.current) / HOLD_MS); setProgress(value);
      if (value >= 1) { start.current = null; callback.current(); setProgress(0); }
      else frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }
  const danger = mode === "end", size = danger ? 144 : 136, radius = size / 2 - 2, length = Math.PI * 2 * radius;
  return <button aria-label={danger ? "稼働終了を長押し" : "稼働開始を長押し"} data-progress={progress}
    onPointerDown={begin} onPointerUp={cancel} onPointerCancel={cancel} onPointerLeave={cancel} onBlur={cancel}
    onKeyDown={e => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); if (!e.repeat) begin(); } }} onKeyUp={cancel}
    style={{ width: size, height: size, position: "relative", display: "grid", placeItems: "center", flexShrink: 0, borderRadius: "50%", touchAction: "none", userSelect: "none" }}>
    <svg aria-hidden="true" width={size} height={size} style={{ position: "absolute", inset: 0, transform: "rotate(-90deg)" }}>
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={danger ? "#FFFFFF33" : "#A9650026"} strokeWidth={4} />
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={danger ? "#FFBAC2" : "#A96500"} strokeWidth={4} strokeDasharray={length} strokeDashoffset={length * (1 - progress)} />
    </svg>
    <span style={{ width: size - 16, height: size - 16, borderRadius: "50%", background: danger ? "#E73949" : "#FFC52C", color: danger ? "white" : "#192333", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 5 }}>
      <strong style={{ fontSize: 18 }}>{danger ? "稼働終了" : "稼働開始"}</strong><small>{progress > 0 ? "そのまま" : "長押し"}</small>
    </span>
  </button>;
}
