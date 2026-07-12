import { useEffect, useRef, useState } from "react";
import { Modal, View, Text, Pressable, ActivityIndicator } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { recognizeLicenseText } from "../ocr/recognizeLicense";

// 安全確認（qr_flow v2.0 Phase2）の抜き打ち確認。免許証を撮影しその場でOCR確認するのみで、
// サーバへは送信・保存しない（現状は監査記録用のカラム/Storageが無いためUIのみで完結させる）。
export function LicenseSpotCheck({
  visible,
  onConfirm,
  onClose,
}: {
  visible: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const camRef = useRef<CameraView>(null);
  const [uri, setUri] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) {
      setUri(null);
      setNote("");
      if (permission && !permission.granted && permission.canAskAgain) requestPermission();
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const scanOnce = async () => {
    if (!camRef.current || busy) return;
    setBusy(true);
    try {
      const pic = await camRef.current.takePictureAsync({ quality: 0.5, skipProcessing: true });
      if (pic?.uri) {
        setUri(pic.uri);
        try {
          const text = await recognizeLicenseText(pic.uri);
          setNote(text.trim() ? "文字を検出しました" : "うまく読み取れませんでした（撮り直せます）");
        } catch {
          setNote("");
        }
      }
    } catch {
      // 失敗時は何もしない（再撮影可）
    } finally {
      setBusy(false);
    }
  };

  const captured = uri != null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 bg-black">
        {permission?.granted ? (
          <CameraView ref={camRef} style={{ flex: 1 }} />
        ) : (
          <View className="flex-1 items-center justify-center p-6">
            <Text className="text-white text-center mb-4">免許証の確認にはカメラの許可が必要です。</Text>
            <Pressable className="px-4 py-2 rounded-lg bg-white active:opacity-80" onPress={() => requestPermission()}>
              <Text className="text-slate-900 font-medium">カメラを許可</Text>
            </Pressable>
          </View>
        )}

        <View className="absolute top-0 left-0 right-0 pt-14 px-5">
          <Text className="text-white text-base font-semibold text-center">免許証が写るように撮影してください</Text>
          <Text className="text-white/70 text-xs text-center mt-1">抜き打ち確認です。この写真は保存されません</Text>
        </View>

        <View className="absolute left-8 right-8 top-1/2 -mt-24 items-center">
          <View className="w-full h-40 rounded-xl border-2 border-white/90" />
          {captured && note ? (
            <View className="mt-4 px-5 py-2 rounded-lg bg-black/60">
              <Text className="text-white text-base font-semibold">{note}</Text>
            </View>
          ) : null}
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
            <Pressable className="rounded-full py-3.5 items-center bg-green-600 active:opacity-80" onPress={onConfirm}>
              <Text className="text-white font-bold text-base">確認できました</Text>
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
