import { MeterGuidePicker } from "../../apps/mobile/src/components/MeterGuideOutline";
import { MeterQualityFeedback } from "../../apps/mobile/src/components/MeterQualityFeedback";
import type { MeterGuide } from "../../apps/mobile/src/capture/meter-quality";
import { useMeterQualityPreview } from "../../apps/mobile/ui-preview/useMeterQualityPreview";
import { MeterPanelPreview } from "../../apps/mobile/ui-preview/MeterPanelPreview";
import { VehicleIdentity } from "../../apps/mobile/src/components/VehiclePlate";
import { SideCaptureReview } from "./SideCaptureReview";
import { isSideAngle } from "../../apps/mobile/src/capture/orientation";
import { CaptureActions } from "./CaptureActions";
import { previewVehicle, previewVehicleLabel } from "../../apps/mobile/ui-preview/vehicle";
import { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBolt, faIdCard, faFileLines, faGauge } from "@fortawesome/free-solid-svg-icons";
import { advanceCapture, canSubmitCapture, CAPTURE_LABELS, newCaptureDraft, type PreviewCaptureStep } from "../../apps/mobile/ui-preview/capture-model";
import { canAutoAdvancePhoto, photoAssessmentMessage, type PhotoAssessment } from "../../apps/mobile/src/capture/camera-options";
import { QrScanMotion, qrMotionCss } from "./QrScanMotion";
import front from "../../apps/mobile/src/capture/assets/van-front.png";
import rear from "../../apps/mobile/src/capture/assets/van-rear.png";
import side from "../../apps/mobile/src/capture/assets/van-side.png";

// 手順/線画/品質メッセージはnative共通。カメラ・判定・送信は隔離fixture。
export function CaptureReview({ target, purpose, onComplete, onCancel, cameraLayout = false }: {
  target: "in" | "out"; purpose: "work" | "move"; onComplete: () => void; onCancel: () => void; cameraLayout?: boolean;
}) {
  const [inspection, setInspection] = useState(true), [draft, setDraft] = useState(() => {
    let value = newCaptureDraft(target, true);
    const state = new URLSearchParams(window.location.search).get("state");
    const initialStep = state === "side-photo" ? "right" : state === "meter-photo" && target === "in" ? "meter" : null;
    if (initialStep && value.plan.includes(initialStep)) while (value.plan[value.index] !== initialStep) value = advanceCapture(value);
    return value;
  });
  const [shot, setShot] = useState(false), [fail, setFail] = useState(false), [error, setError] = useState("");
  const [retakeStep, setRetakeStep] = useState<PreviewCaptureStep | null>(null);
  const [qr, setQr] = useState("present"), [quality, setQuality] = useState("good"), [assessment, setAssessment] = useState<PhotoAssessment | null>(null);
  const [qrStatus, setQrStatus] = useState<"searching" | "verifying" | "verified" | "rejected">("searching");
  const [flash, setFlash] = useState(true), [wide, setWide] = useState(false), [supportsWide, setSupportsWide] = useState(true);
  const step = draft.plan[draft.index], vehicle = ["front", "right", "rear", "left"].includes(step);
  useEffect(() => { setFlash(step !== "meter"); }, [step]);
  const [meterGuide, setMeterGuide] = useState<MeterGuide>("center-right");
  const meterCheck = useMeterQualityPreview(step === "meter" && shot, quality);
  const photo = vehicle || step === "meter" || step === "license";
  const warning = step === "meter" ? null : photoAssessmentMessage(assessment);
  const next = () => { setDraft(d => retakeStep ? { ...d, index: d.plan.indexOf("review") } : advanceCapture(d)); setRetakeStep(null); setShot(false); setAssessment(null); setError(""); setWide(false); };
  const retake = (targetStep: PreviewCaptureStep) => { setRetakeStep(targetStep); setDraft(d => ({ ...d, index: d.plan.indexOf(targetStep) })); setShot(false); setAssessment(null); };
  useEffect(() => {
    if (step !== "qr" || qr === "absent" || qrStatus !== "searching") return;
    let timer: ReturnType<typeof setTimeout>;
    const arm = () => { clearTimeout(timer); if (!document.hidden) timer = setTimeout(() => setQrStatus(qr === "present" ? "verifying" : "rejected"), 2200); };
    arm(); document.addEventListener("visibilitychange", arm);
    return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", arm); };
  }, [step, qr, qrStatus]);
  useEffect(() => { if (step !== "qr" || qrStatus !== "verifying") return; const timer = setTimeout(() => setQrStatus("verified"), 550); return () => clearTimeout(timer); }, [step, qrStatus]);
  useEffect(() => { if (step !== "qr" || qrStatus !== "verified") return; const timer = setTimeout(() => setDraft(d => d.plan[d.index] === "qr" ? advanceCapture(d) : d), 950); return () => clearTimeout(timer); }, [step, qrStatus]);
  useEffect(() => {
    if (!shot || step === "license") return;
    const passed = vehicle ? canAutoAdvancePhoto(assessment) : step === "meter" && meterCheck.state.status === "ready" && meterCheck.state.result.odometerReadable && meterCheck.state.result.fuelReadable && meterCheck.state.result.issues.length === 0;
    if (!passed) return;
    let timer: ReturnType<typeof setTimeout>;
    const arm = () => { clearTimeout(timer); if (!document.hidden) timer = setTimeout(next, 650); };
    arm(); document.addEventListener("visibilitychange", arm);
    return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", arm); };
  }, [shot, step, vehicle, assessment, meterCheck.state, retakeStep]); // eslint-disable-line react-hooks/exhaustive-deps
  const label = purpose === "move" ? target === "in" ? "移動開始" : "移動終了" : target === "in" ? "稼働開始" : "稼働終了";
  const button = (title: string, action: () => void, subdued = false) => <button onClick={action} style={{ padding: 14, minHeight: 48, borderRadius: 16, background: subdued ? "#24262B" : "#FFC52C", color: subdued ? "white" : "#192333", fontSize: 16, fontWeight: 600 }}>{title}</button>;
  if (isSideAngle(step)) return <SideCaptureReview key={step} angle={step as "left" | "right"} shot={shot} warning={warning} onShot={() => { setShot(true); setAssessment({ passed: quality === "good", blur: quality === "blur", framing: quality === "framing", glare: quality === "glare" }); }} onRetake={() => { setShot(false); setAssessment(null); }} onConfirm={next} onCancel={onCancel}
    controls={<div style={{ display: "grid", justifyItems: "center" }}><button aria-label={`フラッシュ：${flash ? "自動" : "オフ"}`} onClick={() => setFlash(!flash)} style={{ minHeight: 44, color: flash ? "#FFD54A" : "white", fontSize: 13 }}>フラッシュ {flash ? "自動" : "オフ"}</button>{supportsWide && <button onClick={() => setWide(!wide)} style={{ minHeight: 44, color: "#FFD54A" }}>{wide ? "広角" : "1×"}</button>}</div>} />;
  return <div role="dialog" aria-modal="true" aria-label={`${label}の撮影`} style={{ position: "absolute", inset: 0, zIndex: 5, background: "#08090B", color: "white", overflowY: "auto" }}><style>{qrMotionCss}</style><div style={{ minHeight: cameraLayout ? "100%" : 740, padding: "24px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
    <p style={{ color: "#ABB2BC", fontSize: 12 }}>{label}　{draft.index + 1}/{draft.plan.length}</p>
    <h2 aria-live="polite" style={{ fontSize: 23, fontWeight: 700 }}>{CAPTURE_LABELS[step]}</h2><VehicleIdentity vehicle={previewVehicle} light />
    <div data-testid="capture-viewfinder" style={{ position: "relative", flex: 1, minHeight: 300, borderRadius: 4, background: "linear-gradient(160deg,#323A40,#1A2026 65%,#444B4C)", display: step === "review" ? "none" : "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
      {vehicle ? <img alt={`${CAPTURE_LABELS[step]}の撮影ガイド`} src={step === "front" ? front : step === "rear" ? rear : side} style={{ position: "absolute", width: "88%", height: "88%", objectFit: "contain", transform: `scaleX(${step === "right" ? -1 : 1})`, opacity: shot ? .55 : 1 }} /> : step === "qr" ? <QrScanMotion state={qrStatus} /> : step === "meter" ? <MeterPanelPreview shot={shot} guide={meterGuide} /> : <FontAwesomeIcon icon={step === "review" ? faFileLines : faIdCard} style={{ width: 64, height: 64 }} />}
      {step === "qr" && qrStatus !== "searching" && <p role={qrStatus === "rejected" ? "alert" : "status"} style={{ position: "absolute", bottom: 16, padding: 12, color: qrStatus === "rejected" ? "#FFB4B4" : "white", background: "#111C", borderRadius: 12, textAlign: "center" }}>{qrStatus === "verifying" ? "車両を確認中" : qrStatus === "verified" ? <>車両を確認しました<br />{previewVehicleLabel}</> : qr === "error" ? "通信できませんでした" : "このQRでは車両を確認できません"}</p>}
      {shot && <p style={{ position: "absolute", bottom: 12, fontSize: 12, background: "#000A", padding: "6px 12px", borderRadius: 12 }}>撮影済み（架空）</p>}
    </div>
    {photo && !shot && <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <button aria-label={`フラッシュ：${flash ? "自動" : "オフ"}`} onClick={() => setFlash(!flash)} style={{ minHeight: 44, padding: 10, fontSize: 12, color: flash ? "#FFD54A" : "#C2C6CD" }}><FontAwesomeIcon icon={faBolt} /> {flash ? "自動" : "オフ"}</button>
      {vehicle && supportsWide && <div style={{ borderRadius: 24, background: "#27292D", padding: 3, display: "flex" }}>{[false, true].map(value => <button key={String(value)} aria-pressed={wide === value} onClick={() => setWide(value)} style={{ borderRadius: 24, minHeight: 40, minWidth: 54, background: wide === value ? "#44474C" : "transparent", color: wide === value ? "#FFD54A" : "white", fontSize: 12 }}>{value ? "広角" : "1×"}</button>)}</div>}
    </div>}
    {step === "meter" && !shot && <MeterGuidePicker value={meterGuide} onChange={setMeterGuide} />}
    {step === "meter" && shot && <MeterQualityFeedback state={meterCheck.state} />}
    {step === "meter" && !shot && <p style={{ color: "#CCD0D6", fontSize: 14 }}>速度計・燃料計・走行距離を入れ、反射を避けて撮影</p>}
    {step === "qr" && qrStatus === "rejected" && button("もう一度読み取る", () => setQrStatus("searching"))}
    {!!error && <p role="alert" style={{ color: "#FFB4B4" }}>{error}</p>}
    {warning && <p role="alert" style={{ color: "#FFE08B", fontSize: 14 }}>{warning}</p>}
    {step === "safety" ? button("免許証を携帯しています", next) : step === "review" ? <>
      <p>{target === "in" ? `メーター写真 1枚${inspection ? "・車両写真 4枚" : ""}` : inspection ? "車両写真 4枚" : "車両の確認済み"}</p>
      {draft.completed.filter(item => ["front", "right", "rear", "left", "meter"].includes(item)).map(item => <button key={item} aria-label={`${CAPTURE_LABELS[item]}を撮り直す`} onClick={() => retake(item)} style={{ minHeight: 64, padding: 8, borderRadius: 14, background: "#252B32", color: "white", display: "flex", alignItems: "center", gap: 12, textAlign: "left" }}>{item === "meter" ? <span style={{ width: 52, height: 48, borderRadius: 8, background: "#39444E", display: "grid", placeItems: "center" }}><FontAwesomeIcon icon={faGauge} /></span> : <img alt="" src={item === "front" ? front : item === "rear" ? rear : side} style={{ width: 52, height: 48, objectFit: "contain", background: "#39444E", borderRadius: 8 }} />}<span style={{ flex: 1 }}>{CAPTURE_LABELS[item]}</span><span aria-hidden="true">撮り直す</span></button>)}
      <CaptureActions confirmLabel={`送信して\n${label}`} retakeLabel={"最初から\n撮り直す"}
        onConfirm={() => { if (!canSubmitCapture(draft)) return; if (fail) { setError("送信できませんでした。写真を残しています。もう一度送信してください。"); return; } onComplete(); }}
        onRetake={() => { setDraft(newCaptureDraft(target, inspection)); setShot(false); setAssessment(null); setError(""); }} />
    </> : photo ? shot ? <CaptureActions disabled={meterCheck.pending} confirmLabel={step === "meter" ? meterCheck.label : warning ? "この写真で続ける" : "この写真を使う"} onConfirm={next} onRetake={() => { setShot(false); setAssessment(null); }} /> : <button data-testid="capture-shutter" aria-label="写真を撮影" onClick={() => { setShot(true); setAssessment({ passed: quality === "good", blur: quality === "blur", framing: quality === "framing", glare: quality === "glare" }); }} style={{ alignSelf: "center", flexShrink: 0, width: 76, height: 76, borderRadius: "50%", border: "3px solid white", padding: 4 }}><span style={{ display: "block", width: "100%", height: "100%", borderRadius: "50%", background: "white" }} /></button> : null}
    <button onClick={onCancel} style={{ minHeight: 44, color: "#C2C6CD" }}>やめる</button>
    <details style={{ fontSize: 12, color: "#AAB0B7", borderTop: "1px solid #333", paddingTop: 12 }}><summary style={{ minHeight: 32 }}>プレビュー設定</summary><div style={{ display: "grid", gap: 14, paddingTop: 8 }}>
      {step === "qr" && <><label>QRの状態 <select aria-label="確認用：QRの状態" value={qr} onChange={e => { setQr(e.target.value); setQrStatus("searching"); }} style={{ color: "#111" }}><option value="present">有効なQR</option><option value="absent">QRなし</option><option value="invalid">無効なQR</option><option value="error">通信エラー</option></select></label><label><input type="checkbox" checked={inspection} onChange={e => { setInspection(e.target.checked); setDraft(newCaptureDraft(target, e.target.checked)); }} /> 確認用：車両撮影が必要な人</label></>}
      {photo && !shot && <><label>写真の判定 <select aria-label="確認用：写真の判定" value={quality} onChange={e => setQuality(e.target.value)} style={{ color: "#111" }}><option value="good">問題なし</option><option value="blur">ブレの疑い</option><option value="framing">表示・車体の欠け</option><option value="glare">光の反射</option>{step === "meter" && <><option value="dark">暗い</option><option value="trip_only">TRIP表示</option><option value="unavailable">判定できない</option></>}</select></label><label><input type="checkbox" checked={supportsWide} onChange={e => { setSupportsWide(e.target.checked); setWide(false); }} /> 確認用：広角レンズあり</label></>}
      {step === "review" && <label><input type="checkbox" checked={fail} onChange={e => setFail(e.target.checked)} /> 確認用：送信エラー</label>}
      <p>カメラ・検出・画質判定・フラッシュ・レンズは架空の動作です。</p>
    </div></details>
  </div></div>;
}
