import { useEffect, useRef, useState } from "react";
import { Modal, View, Text, Pressable, ActivityIndicator } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import { FontAwesome6 } from "@expo/vector-icons";
import { recognizeOdometerBand } from "../ocr/recognizeOdometer";
import type { InspectionAngle } from "../api/work";

// ============================================================
// 統一フルスクリーンキャプチャ（qr_flow v2.0 案A・2026-08-03）。
// QR →（安全確認）→ メーター → 車両点検 を1つの全画面カメラで一筆書きに行う。
// 従来は撮影UIが4種バラバラ（円形カメラ／メーター／点検／免許）で、
// 画面が切り替わるたびに操作の作法が変わっていた。ここに集約して、
//   ・カメラは1つだけ張りっぱなし（ステップ間で再マウントしない＝途切れない）
//   ・上部に進捗、中央にガイド枠、下部にシャッター、という配置を全ステップ共通
//   ・円（PunchButton）は「開始のトリガー＋状態アンカー」に徹する
// を満たす。撮影結果はまとめて返し、保存は呼び出し側（WorkScreen）が行う。
// ============================================================

export type CaptureStep = "qr" | "safety" | "license" | "meter" | "inspection";

export type InspectionShot = { angle: InspectionAngle; base64: string };

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
}: {
  visible: boolean;
  /** 実行するステップ列（呼び出し側が出勤/退勤で組み替える） */
  steps: CaptureStep[];
  /** 上部に出す文脈（例: 稼働開始 / 業務終了） */
  headline: string;
  /** QR 読み取り時の検証。false ならその場に留まりエラー表示は呼び出し側の責務 */
  onQrScanned: (data: string) => Promise<boolean>;
  /** 「QRが読めない」からの退避ルート */
  onFallback?: () => void;
  onComplete: (result: CaptureResult) => void;
  onCancel: () => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const camRef = useRef<CameraView>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  // 直近の撮影（確認して次へ進むまでの一時保持）
  const [shot, setShot] = useState<string | null>(null);
  const [meterValue, setMeterValue] = useState<number | null>(null);
  const [angleIndex, setAngleIndex] = useState(0);
  const [licenseChecked, setLicenseChecked] = useState(false);
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
    setStepIndex(0);
    setShot(null);
    setMeterValue(null);
    setAngleIndex(0);
    setLicenseChecked(false);
    setBusy(false);
    qrHandledRef.current = false;
    resultRef.current = {
      qrData: null,
      meterValue: null,
      meterBase64: null,
      inspection: [],
      licenseBase64: null,
    };
    if (permission && !permission.granted && permission.canAskAgain) requestPermission();
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const step = steps[stepIndex];
  const isCameraStep = step === "qr" || step === "meter" || step === "inspection" || step === "license";

  const goNext = () => {
    setShot(null);
    setMeterValue(null);
    if (stepIndex < steps.length - 1) {
      setStepIndex(stepIndex + 1);
    } else {
      onComplete(resultRef.current);
    }
  };

  async function handleBarcodeScanned(data: string) {
    if (qrHandledRef.current || busy) return;
    qrHandledRef.current = true;
    setBusy(true);
    try {
      const ok = await onQrScanned(data);
      if (ok) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        resultRef.current.qrData = data;
        goNext();
      } else {
        qrHandledRef.current = false; // 読み直せるように戻す
      }
    } finally {
      setBusy(false);
    }
  }

  const takeShot = async () => {
    if (!camRef.current || busy) return;
    setBusy(true);
    try {
      const pic = await camRef.current.takePictureAsync({
        base64: true,
        quality: step === "meter" ? 0.6 : 0.5,
        skipProcessing: true,
      });
      if (pic?.base64) {
        setShot(pic.base64);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        // メーターは OCR で数値を補助プリフィル（写真が正本。読めなくても続行できる）
        if (step === "meter") {
          try {
            setMeterValue(pic.uri ? await recognizeOdometerBand(pic.uri, pic.height ?? 0) : null);
          } catch {
            setMeterValue(null);
          }
        }
      }
    } catch {
      // 失敗時は何もしない（撮り直せる）
    } finally {
      setBusy(false);
    }
  };

  /** 撮影した1枚を確定して次へ（点検は4方向ぶん繰り返す） */
  const confirmShot = () => {
    if (!shot) return;
    if (step === "meter") {
      resultRef.current.meterBase64 = shot;
      resultRef.current.meterValue = meterValue;
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
        ...resultRef.current.inspection,
        { angle: ANGLES[angleIndex], base64: shot },
      ];
      if (angleIndex < ANGLES.length - 1) {
        setAngleIndex(angleIndex + 1);
        setShot(null);
      } else {
        goNext();
      }
    }
  };

  // ステップの案内文（上部）とガイド枠（中央）はステップごとに差し替える。
  const guidance = (): { title: string; note: string } => {
    switch (step) {
      case "qr":
        return { title: "車両のQRコードを読み取ってください", note: "枠の中にQRを入れると自動で読み取ります" };
      case "safety":
        return { title: "安全確認", note: "運転免許証を携帯しているか確認してください" };
      case "license":
        return { title: "免許証を撮影してください", note: "抜き打ちの携帯確認です。文字が読めるように写します" };
      case "meter":
        return { title: "走行距離が写るように撮影してください", note: "写真を保存します。数値は後で修正できます" };
      case "inspection":
        return {
          title: `車両点検（${angleIndex + 1} / ${ANGLES.length}）: ${ANGLE_LABEL[ANGLES[angleIndex]]}から撮影`,
          note: "車体全体が枠に収まるように撮影します",
        };
      default:
        return { title: "", note: "" };
    }
  };
  const { title, note } = guidance();

  const canSkip = step === "meter" || step === "inspection";

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel}>
      <View className="flex-1 bg-black">
        {/* カメラは1枚だけ張り、ステップ間で再マウントしない（流れが途切れない） */}
        {permission?.granted ? (
          <CameraView
            ref={camRef}
            style={{ flex: 1 }}
            barcodeScannerSettings={step === "qr" ? { barcodeTypes: ["qr"] } : undefined}
            onBarcodeScanned={step === "qr" ? ({ data }) => handleBarcodeScanned(data) : undefined}
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

        {/* 非カメラのステップはカメラの上に暗幕を重ねる（マウントは維持したまま） */}
        {!isCameraStep && <View className="absolute inset-0 bg-black/85" />}

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
          <Text className="text-white/70 text-xs text-center mt-1">{note}</Text>
        </View>

        {/* 中央: ステップごとのガイド枠 */}
        {step === "qr" && (
          <View className="absolute left-16 right-16 top-1/2 -mt-32 aspect-square rounded-3xl border-2 border-white/90" />
        )}
        {step === "meter" && (
          <View className="absolute left-5 right-5 top-1/2 -mt-10 items-center">
            <View className="w-full h-20 rounded-xl border-2 border-white/90" />
          </View>
        )}
        {step === "license" && (
          <View className="absolute left-6 right-6 top-1/2 -mt-24 items-center">
            <View className="w-full aspect-[1.6] rounded-xl border-2 border-white/90" />
          </View>
        )}
        {step === "inspection" && (
          <View className="absolute left-6 right-6 top-1/2 -mt-28 items-center">
            <View className="w-full h-56 rounded-2xl border-2 border-dashed border-white/70 items-center justify-center">
              <Text className="text-white/60 text-lg font-semibold">{ANGLE_LABEL[ANGLES[angleIndex]]}</Text>
            </View>
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
                {licenseChecked && <FontAwesome6 name="check" size={14} color="#fff" iconStyle="solid" />}
              </View>
              <Text className="text-white text-base flex-1">免許証を携帯しています</Text>
            </Pressable>
          </View>
        )}

        {/* 撮影済みの手応え */}
        {shot && (
          <View className="absolute inset-x-0 top-1/2 mt-32 items-center">
            <View className="px-5 py-2 rounded-lg bg-black/70">
              <Text className="text-white text-base font-semibold">
                {step === "meter"
                  ? meterValue != null
                    ? `読み取り: ${meterValue} km（要確認）`
                    : "撮影しました（数値は後で入力）"
                  : "撮影しました"}
              </Text>
            </View>
          </View>
        )}

        {/* 下部: シャッター／次へ／スキップ／やめる */}
        <View className="absolute bottom-0 left-0 right-0 pb-12 px-6 gap-3">
          {isCameraStep && step !== "qr" && (
            <Pressable
              className="rounded-full py-3.5 items-center bg-white/90 active:opacity-80 flex-row justify-center gap-2"
              onPress={takeShot}
              disabled={busy}
            >
              {busy ? <ActivityIndicator size="small" color="#0f172a" /> : null}
              <Text className="text-slate-900 font-bold text-base">{shot ? "撮り直す" : "撮影"}</Text>
            </Pressable>
          )}
          {shot && (
            <Pressable
              className="rounded-full py-3.5 items-center bg-accent-500 active:opacity-80"
              onPress={confirmShot}
            >
              <Text className="text-white font-bold text-base">
                {step === "inspection" && angleIndex < ANGLES.length - 1 ? "次の角度へ" : "この写真でOK"}
              </Text>
            </Pressable>
          )}
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
                {step === "meter" ? "メーターはあとで入力" : "点検はスキップ"}
              </Text>
            </Pressable>
          )}
          <Pressable className="py-2 items-center" onPress={onCancel}>
            <Text className="text-white/90 font-medium">やめる</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
