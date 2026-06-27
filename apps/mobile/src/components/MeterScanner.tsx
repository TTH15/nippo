import { useEffect, useRef, useState } from "react";
import { Modal, View, Text, Pressable, ActivityIndicator } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { recognizeOdometerBand } from "../ocr/recognizeOdometer";

// メーター読み取り。中央の枠に走行距離を合わせて「撮影」をタップ → 1回だけ撮影。
// 写真が正本（§7「写真が真実」）。OCRは出たら数値を補助プリフィルするだけ（読めなくてもOK）。
// 誤読時はそのまま撮り直せる。ループしないのでシャッター音は1タップ1回。
export function MeterScanner({
  visible,
  onConfirm,
  onClose,
}: {
  visible: boolean;
  onConfirm: (value: number | null, base64: string) => void;
  onClose: () => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const camRef = useRef<CameraView>(null);
  const [value, setValue] = useState<number | null>(null);
  const [base64, setBase64] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) {
      setValue(null);
      setBase64(null);
      if (permission && !permission.granted && permission.canAskAgain) requestPermission();
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const scanOnce = async () => {
    if (!camRef.current || busy) return;
    setBusy(true);
    try {
      const pic = await camRef.current.takePictureAsync({ base64: true, quality: 0.6, skipProcessing: true });
      if (pic?.base64) {
        setBase64(pic.base64);
        // OCR は補助（読めれば数値を出す。読めなくても写真でOK）。
        try {
          const n = pic.uri ? await recognizeOdometerBand(pic.uri, pic.height ?? 0) : null;
          setValue(n);
        } catch {
          setValue(null);
        }
      }
    } catch {
      // 失敗時は何もしない（再撮影可）
    } finally {
      setBusy(false);
    }
  };

  const confirm = () => {
    if (!base64) return;
    onConfirm(value, base64);
  };

  const captured = base64 != null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 bg-black">
        {permission?.granted ? (
          <CameraView ref={camRef} style={{ flex: 1 }} />
        ) : (
          <View className="flex-1 items-center justify-center p-6">
            <Text className="text-white text-center mb-4">メーターの撮影にはカメラの許可が必要です。</Text>
            <Pressable className="px-4 py-2 rounded-lg bg-white active:opacity-80" onPress={() => requestPermission()}>
              <Text className="text-slate-900 font-medium">カメラを許可</Text>
            </Pressable>
          </View>
        )}

        <View className="absolute top-0 left-0 right-0 pt-14 px-5">
          <Text className="text-white text-base font-semibold text-center">走行距離が写るように撮影してください</Text>
          <Text className="text-white/70 text-xs text-center mt-1">写真を保存します。数値は次の画面で確認・修正できます</Text>
        </View>

        {/* 中央 枠 */}
        <View className="absolute left-5 right-5 top-1/2 -mt-10 items-center">
          <View className="w-full h-20 rounded-xl border-2 border-white/90" />
          {captured && (
            <View className="mt-4 px-5 py-2 rounded-lg bg-black/60">
              <Text className="text-white text-base font-semibold">
                {value != null ? `読み取り: ${value} km（要確認）` : "撮影しました（数値は手入力）"}
              </Text>
            </View>
          )}
        </View>

        {/* 下部アクション */}
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
            <Pressable className="rounded-full py-3.5 items-center bg-green-600 active:opacity-80" onPress={confirm}>
              <Text className="text-white font-bold text-base">この写真でOK</Text>
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
