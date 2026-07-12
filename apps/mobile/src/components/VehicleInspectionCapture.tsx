import { useEffect, useRef, useState } from "react";
import { Modal, View, Text, Pressable, ActivityIndicator } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";

// 車両点検（qr_flow v2.0 Phase3）。前→右→後→左の順に4方向を連続撮影する。
// 各角度に半透明ガイドラインを表示し、車体が同じ位置・同じ角度になるよう誘導する（AI解析前提の撮影品質）。
// 雛形: MeterScanner.tsx。撮影のみを担当し、アップロードは呼び出し側（WorkScreen）が行う。

export type InspectionAngle = "front" | "right" | "rear" | "left";
export type InspectionShot = { angle: InspectionAngle; base64: string };

const ANGLES: readonly InspectionAngle[] = ["front", "right", "rear", "left"];
const ANGLE_LABEL: Record<InspectionAngle, string> = { front: "前", right: "右", rear: "後", left: "左" };

export function VehicleInspectionCapture({
  visible,
  onComplete,
  onClose,
}: {
  visible: boolean;
  onComplete: (shots: InspectionShot[]) => void;
  onClose: () => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const camRef = useRef<CameraView>(null);
  const [index, setIndex] = useState(0);
  const [shots, setShots] = useState<InspectionShot[]>([]);
  const [base64, setBase64] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) {
      setIndex(0);
      setShots([]);
      setBase64(null);
      if (permission && !permission.granted && permission.canAskAgain) requestPermission();
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const angle = ANGLES[index];
  const captured = base64 != null;

  const scanOnce = async () => {
    if (!camRef.current || busy) return;
    setBusy(true);
    try {
      const pic = await camRef.current.takePictureAsync({ base64: true, quality: 0.5, skipProcessing: true });
      if (pic?.base64) setBase64(pic.base64);
    } catch {
      // 失敗時は何もしない（再撮影可）
    } finally {
      setBusy(false);
    }
  };

  const confirmStep = () => {
    if (!base64) return;
    const next = [...shots, { angle, base64 }];
    if (index < ANGLES.length - 1) {
      setShots(next);
      setIndex(index + 1);
      setBase64(null);
    } else {
      onComplete(next);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 bg-black">
        {permission?.granted ? (
          <CameraView ref={camRef} style={{ flex: 1 }} />
        ) : (
          <View className="flex-1 items-center justify-center p-6">
            <Text className="text-white text-center mb-4">車両点検の撮影にはカメラの許可が必要です。</Text>
            <Pressable className="px-4 py-2 rounded-lg bg-white active:opacity-80" onPress={() => requestPermission()}>
              <Text className="text-slate-900 font-medium">カメラを許可</Text>
            </Pressable>
          </View>
        )}

        <View className="absolute top-0 left-0 right-0 pt-14 px-5">
          <Text className="text-white text-base font-semibold text-center">
            車両点検（{index + 1} / {ANGLES.length}）: {ANGLE_LABEL[angle]}から撮影してください
          </Text>
          <Text className="text-white/70 text-xs text-center mt-1">車体全体が枠に収まるように撮影します</Text>
        </View>

        {/* 半透明ガイドライン（車体シルエットの簡易版） */}
        <View className="absolute left-6 right-6 top-1/2 -mt-28 items-center">
          <View className="w-full h-56 rounded-2xl border-2 border-dashed border-white/70 items-center justify-center">
            <Text className="text-white/60 text-lg font-semibold">{ANGLE_LABEL[angle]}</Text>
          </View>
          {captured && (
            <View className="mt-4 px-5 py-2 rounded-lg bg-black/60">
              <Text className="text-white text-base font-semibold">撮影しました</Text>
            </View>
          )}
        </View>

        <View className="absolute bottom-0 left-0 right-0 pb-12 px-6 gap-3">
          <Pressable
            className="rounded-full py-3.5 items-center bg-white/90 active:opacity-80 flex-row justify-center gap-2"
            onPress={scanOnce}
            disabled={busy}
          >
            {busy ? <ActivityIndicator size="small" color="#0f172a" /> : null}
            <Text className="text-slate-900 font-bold text-base">{captured ? "撮り直す" : "撮影"}</Text>
          </Pressable>
          {captured && (
            <Pressable className="rounded-full py-3.5 items-center bg-green-600 active:opacity-80" onPress={confirmStep}>
              <Text className="text-white font-bold text-base">
                {index < ANGLES.length - 1 ? "次の角度へ" : "点検を完了"}
              </Text>
            </Pressable>
          )}
          <Pressable className="py-2 items-center" onPress={onClose}>
            <Text className="text-white/90 font-medium">キャンセル</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
