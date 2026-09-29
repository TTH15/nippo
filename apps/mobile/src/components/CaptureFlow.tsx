import { MeterQualityFeedback } from "./MeterQualityFeedback";
import { checkMeterPhoto, meterQualityCopy, type MeterGuide, type MeterPhotoAssessor, type MeterQualityState } from "../capture/meter-quality";
import { MeterGuideOutline, MeterGuidePicker } from "./MeterGuideOutline";
import { SideCaptureOverlay } from "./SideCaptureOverlay";
import { useCaptureRotation } from "../capture/useCaptureRotation";
import { isSideAngle, isLandscapePhoto, type CaptureRotation } from "../capture/orientation";
import type { CaptureStep } from "../capture/steps";
import { useEffect, useRef, useState } from "react";
import { AppState, Modal, View, Text, Pressable, ActivityIndicator, Image, Platform, ScrollView } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import { AppIcon } from "./AppIcon";
import type { InspectionAngle } from "../api/work";
import { CaptureActions } from "./CaptureActions";
import { VanGuideOutline } from "./VanGuideOutline";
import { QrScanFrame } from "./QrScanFrame";
import { qrMotionTarget, type QrMotionTarget } from "../capture/qr-geometry";
import { canAutoAdvancePhoto, captureLenses, photoAssessmentMessage, type PhotoAssessment } from "../capture/camera-options";

// ============================================================
// 統一フルスクリーンキャプチャ（qr_flow v2.0 案A・2026-08-03）。
// QR →（安全確認）→ 車両点検 → メーター を1つの全画面カメラで一筆書きに行う。
// 従来は撮影UIが4種バラバラ（円形カメラ／メーター／点検／免許）で、
// 画面が切り替わるたびに操作の作法が変わっていた。ここに集約して、
//   ・カメラは1つだけ張りっぱなし（ステップ間で再マウントしない＝途切れない）
//   ・上部に進捗、中央にガイド枠、下部にシャッター、という配置を全ステップ共通
//   ・円（PunchButton）は「開始のトリガー＋状態アンカー」に徹する
// を満たす。撮影結果はまとめて返し、保存は呼び出し側（WorkScreen）が行う。
// ============================================================

export type { CaptureStep } from "../capture/steps";

export type InspectionShot = { angle: InspectionAngle; base64: string };
export type QrVerification = { ok: true; vehicleLabel?: string } | { ok: false; message: string };

export type CaptureResult = {
  qrData: string | null;
  meterValue: number | null;
  meterBase64: string | null;
  inspection: InspectionShot[];
  licenseBase64: string | null;
};

const STEP_TITLE: Record<CaptureStep, string> = {
  qr: "QR",
  safety: "安全確認",
  license: "免許証",
  meter: "メーター",
  inspection: "車両点検",
};

const ANGLES: readonly InspectionAngle[] = ["front", "right", "rear", "left"];
const ANGLE_LABEL: Record<InspectionAngle, string> = { front: "前", right: "右", rear: "後", left: "左" };

export function CaptureFlow({
  visible,
  steps,
  headline,
  onQrScanned,
  onFallback,
  onComplete,
  onCancel,
  assessPhoto,
  assessMeterPhoto,
  allowSkipInspection = true,
}: {
  visible: boolean;
  /** 実行するステップ列（呼び出し側が出勤/退勤で組み替える） */
  steps: CaptureStep[];
  /** 上部に出す文脈（例: 稼働開始 / 業務終了） */
  headline: string;
  /** QR 読み取り時の照合結果。失敗理由はカメラ内で示す。 */
  onQrScanned: (data: string) => Promise<QrVerification>;
  /** 「QRが読めない」からの退避ルート */
  onFallback?: () => void;
  onComplete: (result: CaptureResult) => void;
  onCancel: () => void;
  /** 端末内の画質解析を接続する境界。未接続/失敗は合格とは扱わず、目視確認へ進む。 */
  /** 即時の写り確認。数値読取・承認と分離し、未接続は明示する。 */
  assessMeterPhoto?: MeterPhotoAssessor;
  assessPhoto?: (uri: string, angle: InspectionAngle | null) => Promise<PhotoAssessment | null>;
  allowSkipInspection?: boolean;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const camRef = useRef<CameraView>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [qrStatus, setQrStatus] = useState<"searching" | "verifying" | "verified" | "rejected">("searching");
  const [qrMessage, setQrMessage] = useState("");
  const [qrVehicleLabel, setQrVehicleLabel] = useState("");
  const [qrTarget, setQrTarget] = useState<QrMotionTarget | null>(null);
  const [qrTooSmall, setQrTooSmall] = useState(false);
  const cameraSize = useRef({ width: 0, height: 0 });
  const [flash, setFlash] = useState<"auto" | "off">("auto");
  const [lenses, setLenses] = useState<string[]>([]);
  const [wide, setWide] = useState(false);
  const [assessment, setAssessment] = useState<PhotoAssessment | null>(null);
  const [meterGuide, setMeterGuide] = useState<MeterGuide>("wide");
  const [meterQuality, setMeterQuality] = useState<MeterQualityState>({ status: "idle" });
  const generation = useRef(0), photoRevision = useRef(0), captureBusy = useRef(false);
  const shotHandled = useRef(false);
  const available = captureLenses(lenses);
  // 直近の撮影（確認して次へ進むまでの一時保持）
  const [shot, setShot] = useState<string | null>(null);
  const [angleIndex, setAngleIndex] = useState(0);
  const [licenseChecked, setLicenseChecked] = useState(false);
  const reviewRetake = useRef(false);
  const qrHandledRef = useRef(false);
  const resultRef = useRef<CaptureResult>({
    qrData: null,
    meterValue: null,
    meterBase64: null,
    inspection: [],
    licenseBase64: null,
  });

  useEffect(() => {
    if (!visible) return;
    generation.current++;
    setCameraReady(false); setCameraError(""); setFlash("auto"); setWide(false); setLenses([]); setAssessment(null); captureBusy.current = false;
    setMeterQuality({ status: "idle" });
    setStepIndex(0);
    setShot(null);
    shotHandled.current = false;
    setAngleIndex(0);
    setLicenseChecked(false);
    reviewRetake.current = false;
    setBusy(false);
    setQrStatus("searching"); setQrMessage(""); setQrVehicleLabel(""); setQrTarget(null); setQrTooSmall(false);
    qrHandledRef.current = false;
    resultRef.current = {
      qrData: null,
      meterValue: null,
      meterBase64: null,
      inspection: [],
      licenseBase64: null,
    };
    if (permission && !permission.granted && permission.canAskAgain) requestPermission();
    return () => { generation.current++; };
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const step = steps[stepIndex];
  const reviewing = stepIndex >= steps.length;
  useEffect(() => { setFlash(step === "meter" ? "off" : "auto"); }, [step, visible]);
  const isCameraStep = step === "qr" || step === "meter" || step === "inspection" || step === "license";
  const side = step === "inspection" && isSideAngle(ANGLES[angleIndex]);
  const sideLayout = side && permission?.granted;
  const orientation = useCaptureRotation(visible && side && !shot);
  const [manualRotation, setManualRotation] = useState<CaptureRotation>(null);
  const [shotRotation, setShotRotation] = useState<CaptureRotation>(null);
  const captureRotation = shot ? shotRotation : manualRotation ?? orientation.rotation;
  useEffect(() => { setManualRotation(null); setShotRotation(null); }, [step, angleIndex, visible]);


  const goNext = () => {
    photoRevision.current++;
    setShot(null);
    setAssessment(null); setWide(false); setCameraError("");
    if (reviewRetake.current) {
      reviewRetake.current = false;
      setStepIndex(steps.length);
      return;
    }
    if (stepIndex < steps.length - 1) {
      setStepIndex(stepIndex + 1);
    } else {
      setStepIndex(steps.length);
    }
  };

  const retakeFromReview = (target: "inspection" | "meter", angle?: InspectionAngle) => {
    const index = steps.indexOf(target);
    if (index < 0) return;
    reviewRetake.current = true;
    photoRevision.current++;
    setShot(null); setAssessment(null); setMeterQuality({ status: "idle" });
    if (angle) setAngleIndex(ANGLES.indexOf(angle));
    setStepIndex(index);
  };

  async function handleBarcodeScanned(data: string, cornerPoints: { x: number; y: number }[]) {
    if (qrHandledRef.current || busy || !cameraReady) return;
    const position = qrMotionTarget(cornerPoints, cameraSize.current.width, cameraSize.current.height);
    if (cornerPoints.length >= 4 && !position) { setQrTooSmall(true); return; }
    const token = generation.current;
    qrHandledRef.current = true;
    setQrTooSmall(false);
    void camRef.current?.pausePreview().catch(() => {});
    setQrTarget(position);
    setBusy(true);
    try {
      setQrStatus("verifying"); setQrMessage("");
      const result = await onQrScanned(data);
      if (generation.current !== token) return;
      if (result.ok) {
        setQrStatus("verified"); setQrVehicleLabel(result.vehicleLabel ?? "");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        resultRef.current.qrData = data;
        setTimeout(() => { if (generation.current === token) { void camRef.current?.resumePreview().catch(() => {}); goNext(); } }, 1050);
      } else {
        setQrStatus("rejected"); setQrMessage(result.message);
      }
    } catch {
      if (generation.current === token) { setQrStatus("rejected"); setQrMessage("通信できませんでした。もう一度お試しください。"); }
    } finally {
      if (generation.current === token) setBusy(false);
    }
  }

  const takeShot = async () => {
    if (!camRef.current || busy || captureBusy.current || !cameraReady || (side && !captureRotation)) return;
    const token = generation.current;
    const revision = ++photoRevision.current;
    captureBusy.current = true; shotHandled.current = false; setCameraError(""); setAssessment(null); setMeterQuality({ status: "idle" });
    setBusy(true);
    try {
      const pic = await camRef.current.takePictureAsync({
        base64: true,
        quality: step === "meter" ? 0.6 : 0.5,
        skipProcessing: false,
      });
      if (generation.current !== token || photoRevision.current !== revision) return;
      if (side && pic && !isLandscapePhoto(pic.width, pic.height)) {
        setCameraError("写真が縦向きになりました。横向きのまま、もう一度撮影してください。");
        return;
      }
      if (pic?.base64) {
        setShotRotation(captureRotation);
        setShot(pic.base64);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        if (step === "meter") {
          setMeterQuality({ status: "checking" });
          const value = await checkMeterPhoto(pic.uri, meterGuide, assessMeterPhoto);
          if (generation.current === token && photoRevision.current === revision) setMeterQuality(value);
        } else if (assessPhoto && pic.uri) {
          const value = await assessPhoto(pic.uri, step === "inspection" ? ANGLES[angleIndex] : null).catch(() => null);
          if (generation.current === token && photoRevision.current === revision) setAssessment(value);
        }
      } else {
        setCameraError("撮影できませんでした。もう一度撮影してください。");
      }
    } catch {
      if (generation.current === token && photoRevision.current === revision) setCameraError("撮影できませんでした。もう一度撮影してください。");
    } finally {
      if (generation.current === token) { setBusy(false); captureBusy.current = false; }
    }
  };

  /** 撮影した1枚を確定して次へ（点検は4方向ぶん繰り返す） */
  const confirmShot = () => {
    if (!shot || busy || shotHandled.current) return;
    shotHandled.current = true;
    if (step === "meter") {
      resultRef.current.meterBase64 = shot;
      resultRef.current.meterValue = null; // 数値の採用は写真のサーバー解析・確認後に行う。
      goNext();
      return;
    }
    if (step === "license") {
      resultRef.current.licenseBase64 = shot;
      goNext();
      return;
    }
    if (step === "inspection") {
      resultRef.current.inspection = [
        ...resultRef.current.inspection.filter(value => value.angle !== ANGLES[angleIndex]),
        { angle: ANGLES[angleIndex], base64: shot },
      ];
      if (reviewRetake.current) { goNext(); return; }
      if (angleIndex < ANGLES.length - 1) {
        setAngleIndex(angleIndex + 1);
        setShot(null);
        setAssessment(null);
      } else {
        goNext();
      }
    }
  };

  useEffect(() => {
    if (!shot || busy || !visible) return;
    const passed = step === "inspection" ? canAutoAdvancePhoto(assessment) : step === "meter" && meterQuality.status === "ready" && meterQuality.result.odometerReadable && meterQuality.result.fuelReadable && meterQuality.result.issues.length === 0;
    if (!passed) return;
    let timer: ReturnType<typeof setTimeout>;
    const arm = () => { clearTimeout(timer); if (AppState.currentState === "active") timer = setTimeout(confirmShot, 650); };
    arm(); const listener = AppState.addEventListener("change", arm);
    return () => { clearTimeout(timer); listener.remove(); };
  }, [shot, busy, visible, step, assessment, meterQuality]); // eslint-disable-line react-hooks/exhaustive-deps

  // ステップの案内文（上部）とガイド枠（中央）はステップごとに差し替える。
  const guidance = (): { title: string; note: string } => {
    switch (step) {
      case "qr":
        return { title: "車両のQR", note: "" };
      case "safety":
        return { title: "安全確認", note: "運転免許証を携帯しているか確認してください" };
      case "license":
        return { title: "免許証を撮影してください", note: "抜き打ちの携帯確認です。文字が読めるように写します" };
      case "meter":
        return { title: "メーターパネル全体を撮影", note: "速度計・燃料計・走行距離を入れ、反射を避けて撮影" };
      case "inspection":
        return {
          title: `車両の${ANGLE_LABEL[ANGLES[angleIndex]]}　${angleIndex + 1}/${ANGLES.length}`,
          note: "",
        };
      default:
        return { title: reviewing ? "写真の確認" : "", note: "" };
    }
  };
  const { title, note } = guidance();

  const canSkip = step === "inspection" && allowSkipInspection;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel}>
      <View className="flex-1 bg-black">
        {/* カメラは1枚だけ張り、ステップ間で再マウントしない（流れが途切れない） */}
        {visible && permission?.granted ? (
          <CameraView
            ref={camRef}
            style={{ flex: 1 }}
            onLayout={event => { cameraSize.current = event.nativeEvent.layout; }}
            facing="back"
            responsiveOrientationWhenOrientationLocked={step === "inspection"}
            flash={step === "qr" ? "off" : flash}
            selectedLens={Platform.OS === "ios" ? (step === "inspection" && wide && available.ultra ? available.ultra : available.standard) : undefined}
            onAvailableLensesChanged={({ lenses: values }) => { setLenses(values); if (!captureLenses(values).ultra) setWide(false); }}
            onCameraReady={() => { setCameraReady(true); setCameraError(""); }}
            onMountError={() => { setCameraReady(false); setCameraError("カメラを開けませんでした。閉じてからもう一度お試しください。"); }}
            barcodeScannerSettings={step === "qr" ? { barcodeTypes: ["qr"] } : undefined}
            onBarcodeScanned={step === "qr" && qrStatus === "searching" ? ({ data, cornerPoints }) => handleBarcodeScanned(data, cornerPoints) : undefined}
          />
        ) : (
          <View className="flex-1 items-center justify-center p-6">
            <Text className="text-white text-center mb-4">撮影にはカメラの許可が必要です。</Text>
            <Pressable
              className="px-4 py-2 rounded-lg bg-white active:opacity-80"
              onPress={() => requestPermission()}
            >
              <Text className="text-slate-900 font-medium">カメラを許可</Text>
            </Pressable>
          </View>
        )}
        {shot && !side && <View pointerEvents="none" style={{ position: "absolute", inset: 0, backgroundColor: "black" }}><Image source={{ uri: `data:image/jpeg;base64,${shot}` }} resizeMode="contain" style={{ flex: 1 }} /></View>}

        {/* 非カメラのステップはカメラの上に暗幕を重ねる（マウントは維持したまま） */}
        {!isCameraStep && <View className="absolute inset-0 bg-black/85" />}

        {!sideLayout && <>
        {/* 上部: 文脈＋進捗＋案内 */}
        <View className="absolute top-0 left-0 right-0 pt-14 px-5">
          <Text className="text-white/60 text-xs text-center mb-2">{headline}</Text>
          <View className="flex-row justify-center gap-1.5 mb-3">
            {steps.map((s, i) => (
              <View key={s} className="items-center">
                <View
                  className={`h-1 w-10 rounded-full ${
                    i < stepIndex ? "bg-accent-400" : i === stepIndex ? "bg-white" : "bg-white/25"
                  }`}
                />
                <Text
                  className={`text-[10px] mt-1 ${i === stepIndex ? "text-white" : "text-white/40"}`}
                >
                  {STEP_TITLE[s]}
                </Text>
              </View>
            ))}
          </View>
          <Text className="text-white text-base font-semibold text-center">{title}</Text>
          {!!note && <Text className="text-white/70 text-xs text-center mt-1">{note}</Text>}
        </View>

        {/* 中央: ステップごとのガイド枠 */}
        {step === "qr" && <View style={{ position: "absolute", left: 0, right: 0, top: "50%", marginTop: -116, alignItems: "center" }}><QrScanFrame state={qrStatus} target={qrTarget} /></View>}
        {step === "qr" && qrStatus === "searching" && qrTooSmall && <View style={{ position: "absolute", top: "50%", marginTop: 132, left: 0, right: 0, alignItems: "center" }}><Text style={{ color: "white", backgroundColor: "#111C", paddingHorizontal: 12, paddingVertical: 8 }}>QRに近づける</Text></View>}
        {step === "meter" && !shot && (
          <View pointerEvents="none" style={{ position: "absolute", left: 16, right: 16, top: "28%", bottom: "28%", justifyContent: "center" }}>
            <MeterGuideOutline guide={meterGuide} />
          </View>
        )}
        {step === "license" && (
          <View className="absolute left-6 right-6 top-1/2 -mt-24 items-center">
            <View className="w-full aspect-[1.6] rounded-xl border-2 border-white/90" />
          </View>
        )}
        {step === "inspection" && !shot && (
          <View pointerEvents="none" style={{ position: "absolute", left: 24, right: 24, top: "24%", bottom: "30%" }}>
            <VanGuideOutline angle={ANGLES[angleIndex]} />
          </View>
        )}
        {step === "safety" && (
          <View className="absolute inset-x-8 top-1/2 -mt-16">
            <Pressable
              className="flex-row items-center gap-3 rounded-2xl bg-white/10 px-4 py-5"
              onPress={() => setLicenseChecked((v) => !v)}
            >
              <View
                className={`w-7 h-7 rounded-lg items-center justify-center ${
                  licenseChecked ? "bg-accent-500" : "border-2 border-white/60"
                }`}
              >
                {licenseChecked && <AppIcon name="check" size={14} color="#fff" iconStyle="solid" />}
              </View>
              <Text className="text-white text-base flex-1">免許証を携帯しています</Text>
            </Pressable>
          </View>
        )}
        {reviewing && <ScrollView style={{ position: "absolute", top: 190, bottom: 170, left: 24, right: 24 }} contentContainerStyle={{ gap: 10, paddingBottom: 16 }}>
          {ANGLES.map(angle => {
            const saved = resultRef.current.inspection.find(item => item.angle === angle);
            if (!saved) return null;
            return <Pressable key={angle} accessibilityRole="button" accessibilityLabel={`車両の${ANGLE_LABEL[angle]}を撮り直す`} onPress={() => retakeFromReview("inspection", angle)} style={{ minHeight: 72, padding: 8, borderRadius: 14, backgroundColor: "#252B32", flexDirection: "row", alignItems: "center", gap: 12 }}><Image source={{ uri: `data:image/jpeg;base64,${saved.base64}` }} style={{ width: 58, height: 52, borderRadius: 8 }} /><Text style={{ color: "white", flex: 1, fontSize: 16 }}>車両の{ANGLE_LABEL[angle]}</Text><AppIcon name="camera-rotate" size={16} color="#FFD45C" /></Pressable>;
          })}
          {resultRef.current.meterBase64 && <Pressable accessibilityRole="button" accessibilityLabel="メーターを撮り直す" onPress={() => retakeFromReview("meter")} style={{ minHeight: 72, padding: 8, borderRadius: 14, backgroundColor: "#252B32", flexDirection: "row", alignItems: "center", gap: 12 }}><Image source={{ uri: `data:image/jpeg;base64,${resultRef.current.meterBase64}` }} style={{ width: 58, height: 52, borderRadius: 8 }} /><Text style={{ color: "white", flex: 1, fontSize: 16 }}>メーター</Text><AppIcon name="camera-rotate" size={16} color="#FFD45C" /></Pressable>}
        </ScrollView>}

        {/* 撮影済みの手応え */}
        {shot && (
          <View className="absolute inset-x-0 top-1/2 mt-32 items-center">
            <View className="px-5 py-2 rounded-lg bg-black/70">
              <Text className="text-white text-base font-semibold">
                撮影しました
              </Text>
            </View>
          </View>
        )}

        {/* 下部: シャッター／次へ／スキップ／やめる */}
        <View className="absolute bottom-0 left-0 right-0 pb-12 px-6 gap-3">
          {reviewing && <Pressable accessibilityRole="button" onPress={() => onComplete(resultRef.current)} style={{ minHeight: 52, alignItems: "center", justifyContent: "center", borderRadius: 16, backgroundColor: "#FFC52C" }}><Text style={{ color: "#192333", fontSize: 16, fontWeight: "700" }}>次へ</Text></Pressable>}
          {step === "meter" && !shot && <MeterGuidePicker value={meterGuide} onChange={setMeterGuide} />}
          {step === "meter" && shot && <MeterQualityFeedback state={meterQuality} />}
          {!!cameraError && <Text accessibilityRole="alert" style={{ color: "#FFB4B4", backgroundColor: "#000B", padding: 10 }}>{cameraError}</Text>}
          {step === "qr" && qrStatus !== "searching" && <View style={{ backgroundColor: "#000B", padding: 12, borderRadius: 12, gap: 8 }}><Text accessibilityRole={qrStatus === "rejected" ? "alert" : undefined} style={{ color: qrStatus === "rejected" ? "#FFB4B4" : "white", textAlign: "center", fontWeight: "600" }}>{qrStatus === "verifying" ? "車両を確認中" : qrStatus === "verified" ? "車両を確認しました" : qrMessage}</Text>{qrStatus === "verified" && !!qrVehicleLabel && <Text style={{ color: "#FFFFFF", textAlign: "center", fontSize: 18, fontWeight: "700" }}>{qrVehicleLabel}</Text>}{qrStatus === "rejected" && <Pressable accessibilityRole="button" onPress={() => { void camRef.current?.resumePreview().catch(() => {}); qrHandledRef.current = false; setQrTarget(null); setQrStatus("searching"); setQrMessage(""); }} style={{ minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: "#FFC52C" }}><Text style={{ color: "#192333", fontWeight: "700" }}>もう一度読み取る</Text></Pressable>}</View>}
          {!!photoAssessmentMessage(assessment) && <Text accessibilityRole="alert" style={{ color: "#FFE08B", backgroundColor: "#000B", padding: 10 }}>{photoAssessmentMessage(assessment)}</Text>}
          {isCameraStep && step !== "qr" && !shot && <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Pressable accessibilityLabel={`フラッシュ：${flash === "auto" ? "自動" : "オフ"}`} disabled={busy} onPress={() => setFlash(flash === "auto" ? "off" : "auto")} style={{ minHeight: 44, padding: 10, flexDirection: "row", gap: 6, alignItems: "center", backgroundColor: "#0009", borderRadius: 22 }}><AppIcon name="bolt" size={16} color={flash === "auto" ? "#FFD54A" : "white"} /><Text style={{ color: "white" }}>{flash === "auto" ? "自動" : "オフ"}</Text></Pressable>
            {step === "inspection" && Platform.OS === "ios" && !!available.ultra && !!available.standard && <Pressable disabled={busy} accessibilityRole="button" accessibilityLabel={wide ? "標準レンズへ" : "広角レンズへ"} onPress={() => setWide(!wide)} style={{ minHeight: 44, padding: 12, borderRadius: 22, backgroundColor: "#0009" }}><Text style={{ color: "#FFD54A" }}>{wide ? "広角" : "1×"}</Text></Pressable>}
          </View>}
          {isCameraStep && step !== "qr" && !shot && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="写真を撮影"
              style={{ width: 76, height: 76, borderRadius: 38, borderWidth: 3, borderColor: "white", padding: 4, alignSelf: "center", opacity: busy || !cameraReady ? .45 : 1 }}
              onPress={takeShot}
              disabled={busy || !cameraReady}
            >
              <View style={{ flex: 1, borderRadius: 34, backgroundColor: "white", alignItems: "center", justifyContent: "center" }}>{busy && <ActivityIndicator color="#111" />}</View>
            </Pressable>
          )}
          {shot && <CaptureActions disabled={busy} onRetake={() => { photoRevision.current++; setShot(null); setAssessment(null); setMeterQuality({ status: "idle" }); }} onConfirm={confirmShot}
            confirmLabel={busy ? "写真を確認中" : step === "meter" ? meterQualityCopy(meterQuality).label : photoAssessmentMessage(assessment) ? "この写真で続ける" : "この写真を使う"} />}
          {step === "safety" && (
            <Pressable
              className={`rounded-full py-3.5 items-center bg-accent-500 active:opacity-80 ${
                licenseChecked ? "" : "opacity-40"
              }`}
              onPress={goNext}
              disabled={!licenseChecked}
            >
              <Text className="text-white font-bold text-base">次へ</Text>
            </Pressable>
          )}
          {step === "qr" && onFallback && (
            <Pressable className="py-2 items-center" onPress={onFallback}>
              <Text className="text-white/90 font-medium underline">QRが読めない</Text>
            </Pressable>
          )}
          {canSkip && !shot && (
            <Pressable className="py-2 items-center" onPress={goNext}>
              <Text className="text-white/70 font-medium">
                点検はスキップ
              </Text>
            </Pressable>
          )}
          <Pressable className="py-2 items-center" onPress={onCancel}>
            <Text className="text-white/90 font-medium">やめる</Text>
          </Pressable>
        </View>
        </>}
        {sideLayout && <SideCaptureOverlay angle={ANGLES[angleIndex] as "left" | "right"} rotation={captureRotation} shot={!!shot} photoUri={shot ? `data:image/jpeg;base64,${shot}` : undefined} busy={busy || !cameraReady}
          error={cameraError} warning={photoAssessmentMessage(assessment)} unavailable={orientation.unavailable} onManual={() => setManualRotation(90)}
          onShot={() => void takeShot()} onRetake={() => { photoRevision.current++; setShot(null); setAssessment(null); setCameraError(""); }} onConfirm={confirmShot} onCancel={onCancel} onSkip={goNext}
          controls={<View style={{ gap: 2 }}><Pressable accessibilityRole="button" accessibilityLabel={`フラッシュ：${flash === "auto" ? "自動" : "オフ"}`} disabled={busy} onPress={() => setFlash(flash === "auto" ? "off" : "auto")} style={{ minHeight: 44, alignItems: "center", justifyContent: "center" }}><Text style={{ color: flash === "auto" ? "#FFD54A" : "white", fontSize: 13 }}>フラッシュ {flash === "auto" ? "自動" : "オフ"}</Text></Pressable>
          {Platform.OS === "ios" && !!available.ultra && !!available.standard && <Pressable accessibilityRole="button" disabled={busy} onPress={() => setWide(!wide)} style={{ minHeight: 44, alignItems: "center", justifyContent: "center" }}><Text style={{ color: "#FFD54A" }}>{wide ? "広角" : "1×"}</Text></Pressable>}</View>} />}
      </View>
    </Modal>
  );
}
