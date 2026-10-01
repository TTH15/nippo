import { MeterGuidePicker } from "../src/components/MeterGuideOutline";
import { MeterQualityFeedback } from "../src/components/MeterQualityFeedback";
import type { MeterGuide } from "../src/capture/meter-quality";
import { useMeterQualityPreview } from "./useMeterQualityPreview";
import { MeterPanelPreview } from "./MeterPanelPreview";
import { VehicleIdentity } from "../src/components/VehiclePlate";
import { LicenseGuideOutline } from "../src/components/LicenseGuideOutline";
import { SideCaptureOverlay } from "../src/components/SideCaptureOverlay";
import { useCaptureRotation } from "../src/capture/useCaptureRotation";
import { isSideAngle, type CaptureRotation } from "../src/capture/orientation";
import { CaptureActions } from "../src/components/CaptureActions";
import { VanGuideOutline } from "../src/components/VanGuideOutline";
import type { InspectionAngle } from "../src/api/work";
import { previewVehicle, previewVehicleLabel } from "./vehicle";
import { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, ScrollView, Switch, AppState, Image } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppIcon } from "../src/components/AppIcon";
import { advanceCapture, canSubmitCapture, CAPTURE_LABELS, newCaptureDraft, type PreviewCaptureStep } from "./capture-model";
import { canAutoAdvancePhoto, photoAssessmentMessage, type PhotoAssessment } from "../src/capture/camera-options";
import { QrScanFrame } from "../src/components/QrScanFrame";
import { qrMotionTarget, type QrMotionTarget } from "../src/capture/qr-geometry";

// QRと車体4方向は端末カメラで確認し、照合・画質判定・送信は架空。
export function CapturePreview({ target, purpose, onComplete, onCancel }: {
  target: "in" | "out"; purpose: "work" | "move"; onComplete: (fuel: boolean) => void; onCancel: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [inspection, setInspection] = useState(true), [spotLicense, setSpotLicense] = useState(false);
  const [draft, setDraft] = useState(() => newCaptureDraft(target, true));
  const [alcoholResult, setAlcoholResult] = useState<"none" | "clear" | "detected" | "unavailable">("none");
  const [shot, setShot] = useState(false), [fail, setFail] = useState(false), [error, setError] = useState("");
  const [shotUri, setShotUri] = useState<string | null>(null), [photoBusy, setPhotoBusy] = useState(false);
  const [retakeStep, setRetakeStep] = useState<PreviewCaptureStep | null>(null);
  const [fuel, setFuel] = useState(false), [settings, setSettings] = useState(false);
  const [qr, setQr] = useState("present"), [quality, setQuality] = useState("good"), [assessment, setAssessment] = useState<PhotoAssessment | null>(null);
  const [qrStatus, setQrStatus] = useState<"searching" | "verifying" | "verified" | "rejected">("searching");
  const [qrTarget, setQrTarget] = useState<QrMotionTarget | null>(null);
  const [qrTooSmall, setQrTooSmall] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const qrCamera = useRef<CameraView>(null);
  const cameraSize = useRef({ width: 0, height: 0 });
  const qrHandled = useRef(false);
  const qrHapticSent = useRef(false);
  const [flash, setFlash] = useState(true), [wide, setWide] = useState(false), [supportsWide, setSupportsWide] = useState(true);
  const step = draft.plan[draft.index], vehicle = ["front", "right", "rear", "left"].includes(step);
  useEffect(() => {
    if (step === "qr" || !draft.completed.includes("qr") || qrHapticSent.current) return;
    qrHapticSent.current = true;
    // iOS はカメラ使用中に Taptic Engine が反応しないため、QR カメラが外れた後に鳴らす。
    const timer = setTimeout(() => { void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); }, 180);
    return () => clearTimeout(timer);
  }, [step, draft.completed]);
  const side = isSideAngle(step);
  const orientation = useCaptureRotation(side && !shot);
  const [manualRotation, setManualRotation] = useState<CaptureRotation>(null), [shotRotation, setShotRotation] = useState<CaptureRotation>(null);
  const captureRotation = shot ? shotRotation : manualRotation ?? orientation.rotation;
  useEffect(() => { setManualRotation(null); setShotRotation(null); }, [step]);
  useEffect(() => { setFlash(step !== "meter"); }, [step]);
  const [meterGuide, setMeterGuide] = useState<MeterGuide>("center-right");
  const meterCheck = useMeterQualityPreview(step === "meter" && shot, quality);
  const photo = vehicle || step === "meter" || step === "license", warning = step === "meter" ? null : photoAssessmentMessage(assessment);
  useEffect(() => { if ((step === "qr" || vehicle) && cameraPermission && !cameraPermission.granted && cameraPermission.canAskAgain) void requestCameraPermission(); }, [step, cameraPermission?.granted]); // eslint-disable-line react-hooks/exhaustive-deps
  const captureVehiclePhoto = async () => {
    if (photoBusy) return;
    if (!cameraPermission?.granted || !qrCamera.current) { setError("カメラを開けませんでした。もう一度お試しください。"); return; }
    setPhotoBusy(true); setError("");
    try {
      const picture = await qrCamera.current.takePictureAsync({ quality: 0.8 });
      if (!picture?.uri) throw new Error("Photo missing");
      setShotUri(picture.uri);
      setAssessment(null);
      setShot(true);
    } catch { setError("撮影できませんでした。もう一度撮影してください。"); }
    finally { setPhotoBusy(false); }
  };
  const detectQr = (cornerPoints: { x: number; y: number }[]) => {
    if (qrHandled.current || qrStatus !== "searching" || qr === "absent") return;
    const position = qrMotionTarget(cornerPoints, cameraSize.current.width, cameraSize.current.height);
    if (cornerPoints.length >= 4 && !position) { setQrTooSmall(true); return; }
    qrHandled.current = true;
    setQrTooSmall(false);
    void qrCamera.current?.pausePreview().catch(() => {});
    setQrTarget(position);
    setQrStatus(qr === "present" ? "verifying" : "rejected");
  };
  const resetQr = () => { void qrCamera.current?.resumePreview().catch(() => {}); qrHandled.current = false; setQrTarget(null); setQrTooSmall(false); setQrStatus("searching"); };
  useEffect(() => {
    if (step !== "qr" || qrStatus !== "verifying") return;
    const timer = setTimeout(() => setQrStatus("verified"), 550);
    return () => clearTimeout(timer);
  }, [step, qrStatus]);
  useEffect(() => {
    if (step !== "qr" || qrStatus !== "verified") return;
    const timer = setTimeout(() => { void qrCamera.current?.resumePreview().catch(() => {}); setDraft(d => d.plan[d.index] === "qr" ? advanceCapture(d) : d); }, 950);
    return () => clearTimeout(timer);
  }, [step, qrStatus]);
  useEffect(() => {
    if (!shot || step === "license") return;
    const passed = vehicle ? canAutoAdvancePhoto(assessment) : step === "meter" && meterCheck.state.status === "ready" && meterCheck.state.result.odometerReadable && meterCheck.state.result.fuelReadable && meterCheck.state.result.issues.length === 0;
    if (!passed) return;
    let timer: ReturnType<typeof setTimeout>;
    const arm = () => { clearTimeout(timer); if (AppState.currentState === "active") timer = setTimeout(() => { setDraft(d => retakeStep ? { ...d, index: d.plan.indexOf("review") } : advanceCapture(d)); setRetakeStep(null); setShot(false); setShotUri(null); setAssessment(null); setWide(false); setError(""); }, 650); };
    arm(); const listener = AppState.addEventListener("change", arm);
    return () => { clearTimeout(timer); listener.remove(); };
  }, [shot, step, vehicle, assessment, meterCheck.state, retakeStep]);
  const next = () => { setDraft(d => retakeStep ? { ...d, index: d.plan.indexOf("review") } : advanceCapture(d)); setRetakeStep(null); setShot(false); setShotUri(null); setAssessment(null); setWide(false); setError(""); };
  const retake = (targetStep: PreviewCaptureStep) => { setRetakeStep(targetStep); setDraft(d => ({ ...d, index: d.plan.indexOf(targetStep) })); setShot(false); setShotUri(null); setAssessment(null); };
  const label = purpose === "move" ? target === "in" ? "移動開始" : "移動終了" : target === "in" ? "稼働開始" : "稼働終了";
  const button = (title: string, action: () => void, testID: string, subdued = false) => <Pressable testID={testID} accessibilityRole="button" onPress={action} style={{ padding: 14, minHeight: 48, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: subdued ? "#24262B" : "#FFC52C" }}><Text style={{ color: subdued ? "white" : "#192333", fontSize: 16, fontWeight: "600" }}>{title}</Text></Pressable>;
  const toggle = (title: string, value: boolean, onChange: (value: boolean) => void) => <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}><Text style={{ color: "#AAB0B7", fontSize: 12, flex: 1 }}>{title}</Text><Switch accessibilityLabel={title} value={value} onValueChange={onChange} /></View>;
  const choices = (prefix: string, options: [string, string][], value: string, change: (value: string) => void) => <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{options.map(([key, title]) => <Pressable key={key} accessibilityRole="radio" accessibilityState={{ checked: value === key }} accessibilityLabel={`${prefix}：${title}`} onPress={() => change(key)} style={{ padding: 10, minHeight: 44, borderRadius: 12, backgroundColor: value === key ? "#474A50" : "#24262B" }}><Text style={{ color: "white", fontSize: 12 }}>{title}</Text></Pressable>)}</View>;
  if (side) return <View testID="native-capture" style={{ flex: 1, backgroundColor: "#21292F" }}>
    {cameraPermission?.granted && !shot && <CameraView ref={qrCamera} style={{ position: "absolute", inset: 0 }} facing="back" flash={flash ? "auto" : "off"} responsiveOrientationWhenOrientationLocked />}
    <SideCaptureOverlay angle={step as "left" | "right"} rotation={captureRotation} shot={shot} photoUri={shotUri ?? undefined} busy={photoBusy || !cameraPermission?.granted} error={error} warning={warning}
    unavailable={orientation.unavailable} onManual={() => setManualRotation(90)} onShot={() => { if (captureRotation) { setShotRotation(captureRotation); void captureVehiclePhoto(); } }} onRetake={() => { setShot(false); setShotUri(null); setAssessment(null); }} onConfirm={next} onCancel={onCancel}
    controls={<View style={{ alignItems: "center" }}><Pressable accessibilityRole="button" accessibilityLabel={`フラッシュ：${flash ? "自動" : "オフ"}`} onPress={() => setFlash(!flash)} style={{ minHeight: 44, justifyContent: "center" }}><Text style={{ color: flash ? "#FFD54A" : "white", fontSize: 13 }}>フラッシュ {flash ? "自動" : "オフ"}</Text></Pressable>{supportsWide && <Pressable accessibilityRole="button" accessibilityLabel={wide ? "標準レンズ" : "広角"} onPress={() => setWide(!wide)} style={{ minHeight: 44, justifyContent: "center" }}><Text style={{ color: "#FFD54A" }}>{wide ? "広角" : "1×"}</Text></Pressable>}</View>}
    previewControls={<View style={{ flexDirection: "row", justifyContent: "center", gap: 12 }}>{([90, -90] as const).map(value => <Pressable key={value} accessibilityRole="button" accessibilityLabel={`確認用：${value === 90 ? "左" : "右"}へ回転`} onPress={() => setManualRotation(value)} style={{ minHeight: 44, justifyContent: "center" }}><Text style={{ color: "#87909B", fontSize: 11 }}>確認用：{value === 90 ? "左" : "右"}へ回転</Text></Pressable>)}</View>} /></View>;
  return <ScrollView testID="native-capture" style={{ backgroundColor: "#08090B", flex: 1 }} alwaysBounceVertical={false} contentInsetAdjustmentBehavior="never" contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 20, paddingTop: Math.max(24, insets.top), paddingBottom: Math.max(20, insets.bottom), gap: 14 }}>
    <Text style={{ color: "#ABB2BC", fontSize: 12 }}>{label}　{draft.index + 1}/{draft.plan.length}</Text>
    <Text accessibilityRole="header" accessibilityLiveRegion="polite" style={{ color: "white", fontSize: 23, fontWeight: "700" }}>{CAPTURE_LABELS[step]}</Text>
    <VehicleIdentity vehicle={previewVehicle} light />
    <View testID="capture-viewfinder" style={{ display: ["review", "safety", "alcohol"].includes(step) ? "none" : "flex", flex: 1, minHeight: 280, borderRadius: 4, overflow: "hidden", alignItems: "center", justifyContent: "center", experimental_backgroundImage: "linear-gradient(160deg,#323A40,#1A2026 65%,#444B4C)" }}>
      {step === "qr" && cameraPermission?.granted && <CameraView ref={qrCamera} style={{ position: "absolute", inset: 0 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onLayout={event => { cameraSize.current = event.nativeEvent.layout; }} onBarcodeScanned={qrStatus === "searching" ? result => detectQr(result.cornerPoints) : undefined} />}
      {vehicle && cameraPermission?.granted && !shot && <CameraView ref={qrCamera} style={{ position: "absolute", inset: 0 }} facing="back" flash={flash ? "auto" : "off"} />}
      {vehicle ? shotUri ? <Image source={{ uri: shotUri }} resizeMode="contain" style={{ width: "100%", height: "100%" }} /> : <View style={{ position: "absolute", inset: 0 }}><VanGuideOutline angle={step as InspectionAngle} /></View> : step === "qr" ? <QrScanFrame state={qrStatus} target={qrTarget} /> : step === "meter" ? <MeterPanelPreview shot={shot} guide={meterGuide} /> : step === "license" && !shot ? <View style={{ width: "86%", maxWidth: 320 }}><LicenseGuideOutline /></View> : <AppIcon name={step === "review" ? "file-lines" : step === "alcohol" ? "clipboard-check" : "id-card"} size={64} color="white" />}
      {step === "qr" && qrStatus !== "searching" && <Text accessibilityRole={qrStatus === "rejected" ? "alert" : undefined} style={{ position: "absolute", bottom: 16, padding: 12, color: qrStatus === "rejected" ? "#FFB4B4" : "white", backgroundColor: "#111C", borderRadius: 12, textAlign: "center" }}>{qrStatus === "verifying" ? "車両を確認中" : qrStatus === "verified" ? `車両を確認しました\n${previewVehicleLabel}` : qr === "error" ? "通信できませんでした" : "このQRでは車両を確認できません"}</Text>}
      {step === "qr" && qrStatus === "searching" && qrTooSmall && <Text style={{ position: "absolute", bottom: 16, padding: 10, color: "white", backgroundColor: "#111C", textAlign: "center" }}>QRに近づける</Text>}
      {shot && <Text style={{ position: "absolute", bottom: 12, color: "white", fontSize: 12, backgroundColor: "#000A", padding: 8, borderRadius: 12 }}>{vehicle ? "撮影済み" : "撮影済み（架空）"}</Text>}
    </View>
    {photo && !shot && <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
      <Pressable accessibilityRole="button" accessibilityLabel={`フラッシュ：${flash ? "自動" : "オフ"}`} onPress={() => setFlash(!flash)} style={{ minHeight: 44, padding: 10, flexDirection: "row", alignItems: "center", gap: 6 }}><AppIcon name="bolt" size={13} color={flash ? "#FFD54A" : "#C2C6CD"} /><Text style={{ fontSize: 12, color: flash ? "#FFD54A" : "#C2C6CD" }}>{flash ? "自動" : "オフ"}</Text></Pressable>
      {vehicle && supportsWide && <View style={{ borderRadius: 24, backgroundColor: "#27292D", padding: 3, flexDirection: "row" }}>{[false, true].map(value => <Pressable key={String(value)} accessibilityRole="button" accessibilityLabel={value ? "広角" : "標準レンズ"} accessibilityState={{ selected: wide === value }} onPress={() => setWide(value)} style={{ borderRadius: 24, minHeight: 40, minWidth: 54, alignItems: "center", justifyContent: "center", backgroundColor: wide === value ? "#44474C" : "transparent" }}><Text style={{ color: wide === value ? "#FFD54A" : "white", fontSize: 12 }}>{value ? "広角" : "1×"}</Text></Pressable>)}</View>}
    </View>}
    {step === "meter" && !shot && <MeterGuidePicker value={meterGuide} onChange={setMeterGuide} />}
    {step === "meter" && shot && <MeterQualityFeedback state={meterCheck.state} />}
    {step === "meter" && !shot && <Text style={{ color: "#CCD0D6", fontSize: 14 }}>速度計・燃料計・走行距離を入れ、反射を避けて撮影</Text>}
    {(step === "qr" || vehicle) && !cameraPermission?.granted && button("カメラを許可", () => void requestCameraPermission(), "capture-camera-permission")}
    {step === "qr" && qrStatus === "rejected" && button("もう一度読み取る", resetQr, "capture-qr-retry")}
    {!!error && <Text accessibilityRole="alert" style={{ color: "#FFB4B4" }}>{error}</Text>}
    {!!warning && <Text accessibilityRole="alert" style={{ color: "#FFE08B", fontSize: 14 }}>{warning}</Text>}
    {step === "safety" ? button("免許証を携帯しています", next, "capture-safety") : step === "alcohol" ? <View style={{ gap: 12 }}>
      <Text style={{ color: "white", fontSize: 15 }}>検知器で測定した結果</Text>
      {choices("検知器の結果", [["clear", "酒気なし"], ["detected", "反応あり"], ["unavailable", "測定できない"]], alcoholResult, value => setAlcoholResult(value as typeof alcoholResult))}
      {alcoholResult === "clear" ? button("次へ", next, "capture-alcohol-next") : alcoholResult === "detected" || alcoholResult === "unavailable" ? <Text accessibilityRole="alert" style={{ color: "#FFB4B4" }}>{target === "in" ? `${label}せず、運営に連絡してください。` : "運営に連絡してください。"}</Text> : null}
    </View> : step === "review" ? <>
      <Text style={{ color: "white" }}>{target === "in" ? `メーター写真 1枚${inspection ? "・車両写真 4枚" : ""}` : inspection ? "車両写真 4枚" : "車両の確認済み"}</Text>
      {draft.completed.filter(item => ["front", "right", "rear", "left", "meter"].includes(item)).map(item => <Pressable key={item} accessibilityRole="button" accessibilityLabel={`${CAPTURE_LABELS[item]}を撮り直す`} onPress={() => retake(item)} style={{ minHeight: 64, padding: 8, borderRadius: 14, backgroundColor: "#252B32", flexDirection: "row", alignItems: "center", gap: 12 }}><View style={{ width: 52, height: 48, borderRadius: 8, overflow: "hidden", backgroundColor: "#39444E" }}>{item === "meter" ? <MeterPanelPreview shot guide={meterGuide} /> : <VanGuideOutline angle={item as InspectionAngle} />}</View><Text style={{ color: "white", flex: 1 }}>{CAPTURE_LABELS[item]}</Text><AppIcon name="camera-rotate" size={16} color="#FFD45C" /></Pressable>)}
      <CaptureActions confirmLabel={`送信して\n${label}`} retakeLabel={"最初から\n撮り直す"} confirmTestID="capture-submit" retakeTestID="capture-retake"
        onConfirm={() => { if (!canSubmitCapture(draft)) return; if (fail) { setError("送信できませんでした。写真を残しています。もう一度送信してください。"); return; } onComplete(fuel); }}
        onRetake={() => { setDraft(newCaptureDraft(target, inspection, spotLicense)); setAlcoholResult("none"); setShot(false); setShotUri(null); setAssessment(null); setError(""); }} />
    </> : photo ? shot ? <CaptureActions disabled={meterCheck.pending} confirmLabel={step === "meter" ? meterCheck.label : warning ? "この写真で続ける" : "この写真を使う"} confirmTestID="capture-confirm-photo" retakeTestID="capture-photo" onConfirm={next} onRetake={() => { setShot(false); setShotUri(null); setAssessment(null); }} /> : <Pressable testID="capture-photo" accessibilityRole="button" accessibilityLabel="写真を撮影" disabled={vehicle && (photoBusy || !cameraPermission?.granted)} onPress={() => { if (vehicle) { void captureVehiclePhoto(); return; } setShot(true); setAssessment({ passed: quality === "good", blur: quality === "blur", framing: quality === "framing", glare: quality === "glare" }); }} style={{ flexShrink: 0, width: 76, height: 76, borderRadius: 38, borderWidth: 3, borderColor: "white", padding: 4, alignSelf: "center", opacity: vehicle && (photoBusy || !cameraPermission?.granted) ? .45 : 1 }}><View style={{ flex: 1, borderRadius: 34, backgroundColor: "white" }} /></Pressable> : null}
    <Pressable testID="capture-cancel" accessibilityRole="button" onPress={onCancel} style={{ minHeight: 44, alignItems: "center", justifyContent: "center" }}><Text style={{ color: "#C2C6CD" }}>やめる</Text></Pressable>
    <View style={{ borderTopWidth: 1, borderTopColor: "#333", paddingTop: 4 }}><Pressable testID="capture-settings" accessibilityRole="button" accessibilityState={{ expanded: settings }} onPress={() => setSettings(!settings)} style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8 }}><AppIcon name={settings ? "chevron-down" : "chevron-right"} size={10} color="#AAB0B7" /><Text style={{ color: "#AAB0B7", fontSize: 12 }}>プレビュー設定</Text></Pressable></View>
    {settings && <View style={{ gap: 14 }}>
      {step === "qr" && <>{choices("確認用QR", [["present", "有効なQR"], ["absent", "QRなし"], ["invalid", "無効なQR"], ["error", "通信エラー"]], qr, value => { setQr(value); resetQr(); })}{button("読取成功を試す", () => { setQrTarget(null); qrHandled.current = true; setQrStatus("verifying"); }, "capture-qr-simulate")}{toggle("確認用：車両撮影が必要な人", inspection, value => { setInspection(value); setDraft(newCaptureDraft(target, value, spotLicense)); })}{target === "in" && toggle("確認用：免許証を抜き打ち撮影", spotLicense, value => { setSpotLicense(value); setDraft(newCaptureDraft(target, inspection, value)); })}{target === "in" && purpose === "move" && toggle("移動依頼：給油あり", fuel, setFuel)}</>}
      {photo && !shot && <>{choices("確認用写真", [["good", "問題なし"], ["blur", "ブレの疑い"], ["framing", "表示・車体の欠け"], ["glare", "光の反射"], ...(step === "meter" ? [["dark", "暗い"], ["trip_only", "TRIP表示"], ["unavailable", "判定できない"]] as [string, string][] : [])], quality, setQuality)}{toggle("確認用：広角レンズあり", supportsWide, value => { setSupportsWide(value); setWide(false); })}</>}
      {step === "review" && toggle("確認用：送信エラー", fail, setFail)}
      <Text style={{ color: "#AAB0B7", fontSize: 12 }}>車両照合・画質判定・送信は架空の動作です。</Text>
    </View>}
  </ScrollView>;
}
