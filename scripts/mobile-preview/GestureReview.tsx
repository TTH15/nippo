import { previewVehicleLabel } from "../../apps/mobile/ui-preview/vehicle";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowRight, faCheck, faLocationDot } from "@fortawesome/free-solid-svg-icons";
import { HoldButton } from "./HoldButton";
import { CaptureReview } from "./CaptureReview";
import { HOLD_MS } from "../../apps/mobile/src/components/hold-settings";
import van from "../../apps/mobile/ui-preview/scene/assets/van-poster.png";
import sessionPoster from "../../apps/mobile/ui-preview/scene/assets/session-poster.png";
import { SESSION_SHADE } from "../../apps/mobile/ui-preview/scene/session-presentation";

// SessionShellReviewのホーム/稼働シートを土台に、入口の操作だけを比較する。
// QR以降は既存CaptureReviewを共用。本番Appやnativeの操作方式は変更しない。
type Mode = "start" | "end";
type Variant = "ring" | "hold" | "slide" | "confirm" | "tap";
const variants: { key: Variant; title: string; note: string }[] = [
  { key: "ring", title: "円形の長押し", note: "今の方式。円周ゲージと文言の切り替え。" },
  { key: "hold", title: "横長の長押し", note: "同じ0.8秒。文字は固定し、面が満ちる。" },
  { key: "slide", title: "右へスライド", note: "端まで動かして離す。途中なら元に戻る。" },
  { key: "confirm", title: "タップして確認", note: "普通のボタンから、確認を挟んで撮影へ。" },
  { key: "tap", title: "タップで撮影へ", note: "入口は1タップ。確定は撮影後の送信時。" },
];
const actionName = (mode: Mode) => mode === "start" ? "稼働開始" : "稼働終了";
const buttonStyle = { minHeight: 56, width: "100%", borderRadius: 18, padding: "14px 18px", fontWeight: 700, fontSize: 17, border: 0 };

function useCancelOnExit(cancel: () => void) {
  const latest = useRef(cancel); latest.current = cancel;
  useEffect(() => {
    const reset = () => latest.current();
    const hidden = () => { if (document.hidden) reset(); };
    window.addEventListener("blur", reset); document.addEventListener("visibilitychange", hidden);
    return () => { reset(); window.removeEventListener("blur", reset); document.removeEventListener("visibilitychange", hidden); };
  }, []);
}
function BarHold({ mode, onDone }: { mode: Mode; onDone: () => void }) {
  const [progress, setProgress] = useState(0);
  const start = useRef<number | null>(null), frame = useRef(0);
  const activePointer = useRef<number | null>(null);
  const done = useRef(onDone); done.current = onDone;
  const cancel = () => { cancelAnimationFrame(frame.current); start.current = null; activePointer.current = null; setProgress(0); };
  useCancelOnExit(cancel);
  function begin() {
    if (start.current !== null) return;
    start.current = performance.now();
    const tick = (now: number) => {
      if (start.current === null) return;
      const value = Math.min(1, (now - start.current) / HOLD_MS); setProgress(value);
      if (value === 1) { cancel(); done.current(); } else frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }
  return <button className="gesture-control" aria-label={`${actionName(mode)}を長押し`} data-progress={progress}
    onPointerDown={e => { if (!e.isPrimary || e.button !== 0) return; activePointer.current = e.pointerId; e.currentTarget.setPointerCapture(e.pointerId); begin(); }}
    onPointerMove={e => { if (activePointer.current !== e.pointerId) return; const r = e.currentTarget.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) cancel(); }}
    onPointerUp={cancel} onPointerCancel={cancel} onLostPointerCapture={cancel} onBlur={cancel}
    onContextMenu={e => e.preventDefault()}
    onKeyDown={e => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); if (!e.repeat) begin(); } if (e.key === "Escape") cancel(); }}
    onKeyUp={cancel} style={{ ...buttonStyle, minHeight: 68, position: "relative", overflow: "hidden", touchAction: "pan-y", userSelect: "none", background: mode === "start" ? "#FFE8A6" : "#842B38", color: mode === "start" ? "#192333" : "white" }}>
    <span aria-hidden="true" style={{ position: "absolute", inset: 0, transform: `scaleX(${progress})`, transformOrigin: "left", background: mode === "start" ? "#FFC52C" : "#E73949" }} />
    <span style={{ position: "relative" }}>{actionName(mode)}</span>
  </button>;
}
function Slide({ mode, onDone, onAlternative }: { mode: Mode; onDone: () => void; onAlternative: () => void }) {
  const [progress, setProgress] = useState(0);
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; y: number; travel: number; value: number } | null>(null);
  const cancel = () => { drag.current = null; setProgress(0); };
  useCancelOnExit(cancel);
  function move(e: ReactPointerEvent<HTMLButtonElement>) {
    const d = drag.current; if (!d || d.id !== e.pointerId) return;
    if (Math.abs(e.clientY - d.y) > 64) { cancel(); return; }
    d.value = Math.max(0, Math.min(1, (e.clientX - d.x) / d.travel)); setProgress(d.value);
  }
  return <div style={{ width: "100%" }}>
    <div ref={track} data-testid="slide-track" data-progress={progress} style={{ height: 68, position: "relative", borderRadius: 34, background: mode === "start" ? "#E5EAF0" : "#FFFFFF26", overflow: "hidden", userSelect: "none" }}>
      <span aria-hidden="true" style={{ position: "absolute", inset: 0, background: mode === "start" ? "#FFE8A6" : "#A63140", transform: `scaleX(${progress})`, transformOrigin: "left" }} />
      <span style={{ position: "absolute", inset: "0 10px 0 64px", display: "grid", placeItems: "center", fontWeight: 600, fontSize: 15 }}>{mode === "start" ? "スライドで開始" : "スライドで終了"}</span>
      <button className="gesture-control" aria-label={`右にスライドして${actionName(mode)}`} data-testid="slide-thumb"
        onPointerDown={e => { if (!e.isPrimary || e.button !== 0 || drag.current) return; const travel = (track.current?.clientWidth ?? 0) - 68; if (travel <= 0) return; drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, travel, value: 0 }; e.currentTarget.setPointerCapture(e.pointerId); }}
        onPointerMove={move} onPointerUp={e => { move(e); const ready = drag.current?.id === e.pointerId && drag.current.value >= .94; cancel(); if (ready) onDone(); }}
        onPointerCancel={cancel} onLostPointerCapture={cancel} onBlur={cancel} onContextMenu={e => e.preventDefault()}
        onKeyDown={e => { if (e.key === "Escape") cancel(); }} onClick={e => { if (e.detail === 0) onAlternative(); }}
        style={{ position: "absolute", top: 6, left: `calc(6px + ${progress} * (100% - 68px))`, width: 56, height: 56, borderRadius: "50%", border: 0, background: mode === "start" ? "#FFC52C" : "#E73949", color: mode === "start" ? "#192333" : "white", touchAction: "pan-y", boxShadow: "0 2px 5px #0002" }}>
        <FontAwesomeIcon icon={progress >= .94 ? faCheck : faArrowRight} />
      </button>
    </div>
    <button className="gesture-control" onClick={onAlternative} style={{ width: "100%", minHeight: 44, marginTop: 8, fontSize: 13, textDecoration: "underline" }}>ボタンで進む</button>
  </div>;
}
function Trial({ variant, mode }: { variant: typeof variants[number]; mode: Mode }) {
  const [step, setStep] = useState<"ready" | "confirm" | "capture" | "done">("ready");
  const controlHost = useRef<HTMLDivElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null), returnButton = useRef<HTMLButtonElement>(null);
  const ready = step === "ready", dark = mode === "end";
  useEffect(() => { if (step === "confirm") confirmButton.current?.focus(); if (step === "done") returnButton.current?.focus(); }, [step]);
  function reset() { setStep("ready"); requestAnimationFrame(() => controlHost.current?.querySelector("button")?.focus()); }
  const fill = { background: dark ? "#E73949" : "#FFC52C", color: dark ? "white" : "#192333" };
  return <article data-testid={`trial-${variant.key}`} style={{ minWidth: 0 }}>
    <h2 style={{ fontSize: 20, fontWeight: 700 }}>{variant.title}</h2><p style={{ fontSize: 13, color: "#526074", margin: "7px 0 16px", minHeight: 40 }}>{variant.note}</p>
    <div style={{ height: 610, borderRadius: 28, border: "1px solid #DCE3EC", overflow: "hidden", position: "relative", background: dark ? "#182B4A" : "#F6F8FB", color: dark ? "white" : "#192333" }}>
      {dark && <><img src={sessionPoster} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} /><div style={{ position: "absolute", inset: 0, background: SESSION_SHADE }} /></>}
      <div inert={!ready} style={{ position: "relative", height: "100%", display: "flex", flexDirection: "column", padding: 22 }}>
        {dark ? <><div style={{ height: 4, width: 40, borderRadius: 4, background: "#FFFFFF88", alignSelf: "center", marginBottom: 24 }} /><h3 style={{ fontSize: 27, fontWeight: 700 }}>稼働中</h3><p style={{ fontSize: 14, marginTop: 6 }}>2時間18分</p><div style={{ flex: 1 }} /></> : <><p style={{ fontSize: 13 }}>9月23日（水）</p><h3 style={{ fontSize: 25, fontWeight: 700, marginTop: 18 }}>今日の稼働</h3><p style={{ fontSize: 14, marginTop: 8 }}>中央エリア</p><img src={van} alt="今日の割当車両 エブリイ" style={{ width: "100%", aspectRatio: "2.15", objectFit: "contain", margin: "20px 0 8px" }} /></>}
        <p style={{ fontSize: 18, fontWeight: 700, textAlign: dark ? "left" : "center" }}>{previewVehicleLabel}</p>
        {!dark && <div style={{ marginTop: 20, borderRadius: 16, padding: 16, background: "white", fontSize: 14 }}><FontAwesomeIcon icon={faLocationDot} />　中央車庫　3番区画</div>}
        <div ref={controlHost} style={{ marginTop: "auto", paddingTop: 22, minHeight: 185, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12 }}>
          {ready && (variant.key === "ring" ? <HoldButton mode={mode} onTriggered={() => setStep("capture")} /> : variant.key === "hold" ? <BarHold mode={mode} onDone={() => setStep("capture")} /> : variant.key === "slide" ? <Slide mode={mode} onDone={() => setStep("capture")} onAlternative={() => setStep("confirm")} /> : <button className="gesture-control" style={{ ...buttonStyle, ...fill }} onClick={() => setStep(variant.key === "tap" ? "capture" : "confirm")}>{variant.key === "tap" ? mode === "start" ? "開始の確認へ" : "終了の確認へ" : actionName(mode)}</button>)}
        </div>
      </div>
      {step === "confirm" && <div role="dialog" aria-modal="true" aria-label={`${actionName(mode)}の確認`} onKeyDown={e => { if (e.key === "Escape") reset(); if (e.key === "Tab") { const nodes = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("button")); e.preventDefault(); nodes[(nodes.indexOf(document.activeElement as HTMLButtonElement) + (e.shiftKey ? -1 : 1) + nodes.length) % nodes.length]?.focus(); } }} style={{ position: "absolute", inset: 0, background: "#0006", display: "flex", alignItems: "flex-end" }}>
        <div style={{ width: "100%", padding: 24, background: "#fff", color: "#192333", borderRadius: "24px 24px 0 0", display: "grid", gap: 16 }}><h3 style={{ fontSize: 22, fontWeight: 700 }}>{mode === "start" ? "開始の確認へ進みますか？" : "終了の確認へ進みますか？"}</h3><p>{previewVehicleLabel}</p><button ref={confirmButton} className="gesture-control" style={{ ...buttonStyle, ...fill }} onClick={() => setStep("capture")}>QR・撮影へ進む</button><button className="gesture-control" style={buttonStyle} onClick={reset}>戻る</button></div>
      </div>}
      {step === "capture" && <CaptureReview target={mode === "start" ? "in" : "out"} purpose="work" onComplete={() => setStep("done")} onCancel={reset} />}
      {step === "done" && <div role="status" style={{ position: "absolute", inset: 0, padding: 28, background: "#F6F8FB", color: "#192333", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 24 }}><FontAwesomeIcon icon={faCheck} size="2x" /><p>{mode === "start" ? "稼働を開始しました（架空）" : "稼働を終了しました（架空）"}</p><button ref={returnButton} className="gesture-control" style={{ ...buttonStyle, background: "#FFC52C" }} onClick={reset}>もう一度試す</button></div>}
    </div>
  </article>;
}
export function GestureReview() {
  const [mode, setMode] = useState<Mode>("start"), [revision, setRevision] = useState(0);
  return <div className="space-y-6">
    <style>{`.gesture-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,290px),1fr));gap:28px}.gesture-control:focus-visible{outline:3px solid #3B82F6;outline-offset:3px}`}</style>
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }} role="group" aria-label="比較する操作">
      {(["start", "end"] as const).map(value => <button key={value} aria-pressed={mode === value} onClick={() => setMode(value)} style={{ minHeight: 44, borderRadius: 12, padding: "10px 18px", background: mode === value ? "#192333" : "#EDF1F5", color: mode === value ? "white" : "#192333", fontWeight: 600 }}>{value === "start" ? "稼働前で比較" : "稼働中で比較"}</button>)}
      <button onClick={() => setRevision(v => v + 1)} style={{ minHeight: 44, padding: "10px 18px", textDecoration: "underline" }}>すべて戻す</button>
    </div>
    <p style={{ color: "#526074", fontSize: 14 }}>どの案もQR・撮影へ進む入口です。写真を送信するまでは開始・終了しません。すべて架空データです。</p>
    <div className="gesture-grid">{variants.map(variant => <Trial key={`${variant.key}:${mode}:${revision}`} variant={variant} mode={mode} />)}</div>
  </div>;
}
