import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronRight, faCheck } from "@fortawesome/free-solid-svg-icons";
import { disclosureTransition, quickDisclosureTransition } from "../../apps/web/src/lib/ui/motion";

export type RibbonOrigin = { left: number; top: number; width: number; height: number };
const easing = `cubic-bezier(${disclosureTransition.ease.join(",")})`;
export function RibbonControl({ mode, onOpen, onInteractionChange }: { mode: "start" | "end"; onOpen: (origin: RibbonOrigin) => void; onInteractionChange?: (active: boolean) => void }) {
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; y: number; width: number; value: number } | null>(null);
  const opening = useRef(false);
  const [progress, setProgress] = useState(0), [dragging, setDragging] = useState(false);
  const id = useId().replace(/:/g, "");
  const interaction = useRef(onInteractionChange); interaction.current = onInteractionChange;
  const cancel = () => { drag.current = null; setDragging(false); setProgress(0); interaction.current?.(false); };
  useEffect(() => {
    if (!dragging) return;
    const stopScroll = (event: WheelEvent) => event.preventDefault();
    window.addEventListener("wheel", stopScroll, { passive: false });
    return () => window.removeEventListener("wheel", stopScroll);
  }, [dragging]);
  useEffect(() => {
    const reset = () => cancel(), hidden = () => { if (document.hidden) reset(); };
    window.addEventListener("blur", reset); document.addEventListener("visibilitychange", hidden);
    return () => { drag.current = null; interaction.current?.(false); window.removeEventListener("blur", reset); document.removeEventListener("visibilitychange", hidden); };
  }, []);
  function open() {
    if (opening.current || !track.current) return;
    opening.current = true; interaction.current?.(false); drag.current = null; setDragging(false); setProgress(1);
    const { left, top, width, height } = track.current.getBoundingClientRect(); onOpen({ left, top, width, height });
  }
  function move(e: ReactPointerEvent<HTMLButtonElement>) {
    const d = drag.current; if (!d || d.id !== e.pointerId) return;
    d.value = Math.max(0, Math.min(1, (e.clientX - d.x) / d.width)); setProgress(d.value);
  }
  // viewBox内の輪郭。指に追従する玉へ向かって、根元の細い帯を滑らかに広げる。
  const x = 36 + progress * 248;
  const path = `M 33 28 C ${33 + (x - 33) * .65} 29, ${x - 28} 9, ${x} 9 L ${x} 63 C ${x - 28} 63, ${33 + (x - 33) * .65} 43, 33 44 A 8 8 0 0 1 33 28 Z`;
  return <div style={{ width: "100%" }}>
    <style>{`.ribbon-thumb:focus-visible{outline:3px solid #4785CD;outline-offset:3px}@media(prefers-reduced-motion:reduce){.ribbon-return{transition:none!important}}`}</style>
    <div ref={track} data-testid="ribbon-track" data-progress={progress} style={{ height: 72, position: "relative", borderRadius: 36, border: "1px solid #FFFFFFAA", background: mode === "start" ? "linear-gradient(135deg,#FFFFFFD9,#DCE4ED99)" : "linear-gradient(135deg,#FFFFFF38,#FFFFFF12)", boxShadow: "inset 0 1px 1px #FFFFFFCC, 0 5px 15px #10243B0C", backdropFilter: "blur(12px)", userSelect: "none" }}>
      <svg aria-hidden="true" viewBox="0 0 320 72" preserveAspectRatio="none" style={{ width: "100%", height: "100%", position: "absolute", inset: 0, overflow: "hidden", borderRadius: 36 }}>
        <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#FFEAA0" /><stop offset=".48" stopColor="#FFCE43" stopOpacity=".72" /><stop offset="1" stopColor="#EFAE18" stopOpacity=".9" /></linearGradient></defs>
        {progress > 0 && <path d={path} fill={`url(#${id})`} stroke="#FFF4BE" strokeWidth="1.2" />}
        <circle cx="33" cy="36" r="8" fill="#F6C648" stroke="#FFF3B1" strokeWidth="2" />
      </svg>
      <span style={{ position: "absolute", inset: "0 14px 0 70px", display: "grid", placeItems: "center", color: mode === "start" ? "#35445A" : "#FFFFFF", fontSize: 15, fontWeight: 600, opacity: Math.max(0, 1 - progress * 2), pointerEvents: "none" }}>{mode === "start" ? "スライドで開始" : "スライドで終了"}</span>
      <button className="ribbon-thumb ribbon-return" data-testid={`ribbon-${mode}`} aria-label={`右へスライドして${mode === "start" ? "開始" : "終了"}の撮影へ`}
        onPointerDown={e => { if (!e.isPrimary || e.button !== 0 || opening.current || drag.current) return; const width = (track.current?.clientWidth ?? 0) - 72; if (width <= 0) return; drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, width, value: 0 }; setDragging(true); interaction.current?.(true); e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); }}
        onPointerMove={move} onPointerUp={e => { move(e); const ready = drag.current?.id === e.pointerId && drag.current.value >= .94; if (ready) open(); else cancel(); }}
        onPointerCancel={cancel} onLostPointerCapture={() => { if (!opening.current) cancel(); }} onBlur={() => { if (!opening.current) cancel(); }}
        onContextMenu={e => e.preventDefault()} onKeyDown={e => { if (e.key === "Escape") cancel(); }} onClick={e => { if (e.detail === 0) open(); }}
        style={{ width: 58, height: 58, position: "absolute", top: 6, left: `calc(6px + ${progress} * (100% - 72px))`, borderRadius: "50%", border: "1px solid #FFF4B9", background: "linear-gradient(145deg,#FFE889,#FFC52C 62%,#F2B927)", boxShadow: "inset 0 2px 2px #FFF8D9, inset 0 -2px 3px #C68D2544, 0 3px 7px #765C1833", color: "#29374A", fontSize: 21, touchAction: "none", transition: dragging ? "none" : `left ${quickDisclosureTransition.duration}s ${easing}` }}>
        <FontAwesomeIcon icon={progress >= .94 ? faCheck : faChevronRight} />
      </button>
    </div>
  </div>;
}

export function CaptureReveal({ origin, onCancel, children }: { origin: RibbonOrigin | null; onCancel: () => void; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null), content = useRef<HTMLDivElement>(null);
  const [settled, setSettled] = useState(false);
  useEffect(() => { if (settled) content.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true }); }, [settled]);
  useLayoutEffect(() => {
    const element = root.current!;
    let alive = true;
    element.focus({ preventScroll: true });
    const focus = () => { if (alive) setSettled(true); };
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    if (!origin || reduced.matches) { focus(); return () => { alive = false; }; }
    // ネイティブと同じ全画面フェード。タブ領域も同じフレームで覆う。
    const animation = element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: disclosureTransition.duration * 1000, easing, fill: "both" });
    animation.finished.then(focus).catch(() => {});
    const stopMotion = () => { if (reduced.matches) { animation.finish(); } };
    reduced.addEventListener("change", stopMotion);
    return () => { alive = false; animation.cancel(); reduced.removeEventListener("change", stopMotion); };
  }, [origin]);
  return <div ref={root} tabIndex={-1} data-testid="capture-reveal" data-settled={settled} onKeyDown={e => {
    if (e.key === "Escape") { e.stopPropagation(); onCancel(); }
    if (e.key === "Tab") {
      const nodes = Array.from(root.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),[tabindex="0"]') ?? []);
      if (!nodes.length) { e.preventDefault(); return; }
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }} style={{ position: "absolute", inset: 0, zIndex: 10, overflow: "hidden", background: "#101A29" }}>
    <div ref={content} inert={!settled} style={{ position: "absolute", inset: 0 }}>{children}</div>
  </div>;
}
