import { useEffect, useRef, useState } from "react";
import { Modal, View, Text, Pressable, ActivityIndicator, TextInput, ScrollView } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import type { VehiclePlateData } from "@repo/core/types";
import { recognizePlateText, matchVehiclesByPlateText } from "../ocr/recognizePlate";
import { uploadPlatePhoto } from "../api/work";

// QRが読めない時の退避ルート（vehicle-session-flow.md §8.5）。
// 「QRが読めない」→ナンバープレート撮影OCR→（一致すれば）確認、曖昧なら一覧から選択。
// 写真が撮れる限り method="plate_ocr"（信頼度を下げて記録・運営一覧で「QR未使用」可視化）。
// 撮影自体ができない最終手段のみ method="manual"（理由必須・運営承認制）。
const plateLabel = (v: VehiclePlateData): string =>
  [v.number_prefix, v.number_class, v.number_hiragana, v.number_numeric].filter(Boolean).join(" ") || v.id;

type Step = "menu" | "camera" | "confirm" | "pick" | "manual-reason" | "manual-pick";

export type FallbackResolution =
  | { vehicle: VehiclePlateData; method: "plate_ocr"; platePhotoPath: string }
  | { vehicle: VehiclePlateData; method: "manual"; fallbackReason: string };

export function QrFallback({
  visible,
  vehicles,
  onResolved,
  onClose,
}: {
  visible: boolean;
  vehicles: VehiclePlateData[];
  onResolved: (result: FallbackResolution) => void;
  onClose: () => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const camRef = useRef<CameraView>(null);
  const [step, setStep] = useState<Step>("menu");
  const [base64, setBase64] = useState<string | null>(null);
  const [matches, setMatches] = useState<VehiclePlateData[]>([]);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (visible) {
      setStep("menu");
      setBase64(null);
      setMatches([]);
      setBusy(false);
      setReason("");
    }
  }, [visible]);

  useEffect(() => {
    if (step === "camera" && permission && !permission.granted && permission.canAskAgain) requestPermission();
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  const scanOnce = async () => {
    if (!camRef.current || busy) return;
    setBusy(true);
    try {
      const pic = await camRef.current.takePictureAsync({ base64: true, quality: 0.6, skipProcessing: true });
      if (pic?.base64 && pic?.uri) {
        setBase64(pic.base64);
        try {
          const text = await recognizePlateText(pic.uri);
          const found = matchVehiclesByPlateText(text, vehicles);
          setMatches(found);
          setStep(found.length === 1 ? "confirm" : "pick");
        } catch {
          setMatches([]);
          setStep("pick");
        }
      }
    } catch {
      // 失敗時は何もしない（再撮影可）
    } finally {
      setBusy(false);
    }
  };

  const confirmPlateVehicle = async (vehicle: VehiclePlateData) => {
    if (!base64 || busy) return;
    setBusy(true);
    try {
      const { path } = await uploadPlatePhoto(base64);
      onResolved({ vehicle, method: "plate_ocr", platePhotoPath: path });
    } catch {
      // アップロード失敗時はやり直し（撮影済みなので一覧選択には戻さず撮影からリトライ）
      setBusy(false);
      setStep("camera");
      setBase64(null);
    }
  };

  const submitManual = (vehicle: VehiclePlateData) => {
    if (!reason.trim()) return;
    onResolved({ vehicle, method: "manual", fallbackReason: reason.trim() });
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      {step === "menu" && (
        <View className="flex-1 bg-white p-6 pt-16 gap-4">
          <Text className="text-xl font-bold text-brand-900">QRが読めない場合</Text>
          <Text className="text-[13px] text-brand-500">ナンバープレートを撮影して照合します。撮影できない場合のみ、手動での申請（運営承認制）を選べます。</Text>
          <Pressable className="bg-accent-500 rounded-lg py-3.5 items-center active:opacity-80 mt-2" onPress={() => setStep("camera")}>
            <Text className="text-white font-semibold text-base">ナンバープレートを撮影する</Text>
          </Pressable>
          <Pressable className="py-2.5 items-center" onPress={() => setStep("manual-reason")}>
            <Text className="text-brand-500 text-[13px]">撮影せず車両を選ぶ（要運営承認）</Text>
          </Pressable>
          <Pressable className="mt-auto py-2 items-center" onPress={onClose}>
            <Text className="text-brand-400 font-medium">やめる</Text>
          </Pressable>
        </View>
      )}

      {step === "camera" && (
        <View className="flex-1 bg-black">
          {permission?.granted ? (
            <CameraView ref={camRef} style={{ flex: 1 }} />
          ) : (
            <View className="flex-1 items-center justify-center p-6">
              <Text className="text-white text-center mb-4">ナンバープレートの撮影にはカメラの許可が必要です。</Text>
              <Pressable className="px-4 py-2 rounded-lg bg-white active:opacity-80" onPress={() => requestPermission()}>
                <Text className="text-slate-900 font-medium">カメラを許可</Text>
              </Pressable>
            </View>
          )}
          <View className="absolute top-0 left-0 right-0 pt-14 px-5">
            <Text className="text-white text-base font-semibold text-center">ナンバープレートが写るように撮影してください</Text>
          </View>
          <View className="absolute left-10 right-10 top-1/2 -mt-16 items-center">
            <View className="w-full h-28 rounded-xl border-2 border-dashed border-white/80" />
          </View>
          <View className="absolute bottom-0 left-0 right-0 pb-12 px-6 gap-3">
            <Pressable
              className="rounded-full py-3.5 items-center bg-white/90 active:opacity-80 flex-row justify-center gap-2"
              onPress={scanOnce}
              disabled={busy}
            >
              {busy ? <ActivityIndicator size="small" color="#0f172a" /> : null}
              <Text className="text-slate-900 font-bold text-base">撮影</Text>
            </Pressable>
            <Pressable className="py-2 items-center" onPress={onClose}>
              <Text className="text-white/90 font-medium">キャンセル</Text>
            </Pressable>
          </View>
        </View>
      )}

      {step === "confirm" && matches.length === 1 && (
        <View className="flex-1 bg-white p-6 pt-16 gap-4">
          <Text className="text-[13px] text-brand-500">この車両で間違いありませんか？</Text>
          <Text className="text-2xl font-bold text-brand-900">{plateLabel(matches[0])}</Text>
          <Pressable
            className="bg-accent-500 rounded-lg py-3.5 items-center active:opacity-80 mt-2"
            onPress={() => confirmPlateVehicle(matches[0])}
            disabled={busy}
          >
            {busy ? <ActivityIndicator color="#fff" /> : <Text className="text-white font-semibold text-base">この車両で確定</Text>}
          </Pressable>
          <Pressable className="py-2.5 items-center" onPress={() => setStep("pick")} disabled={busy}>
            <Text className="text-brand-500 text-[13px]">違う車両（一覧から選ぶ）</Text>
          </Pressable>
        </View>
      )}

      {step === "pick" && (
        <View className="flex-1 bg-white pt-16">
          <View className="px-6 pb-3 gap-1.5">
            <Text className="text-xl font-bold text-brand-900">車両を選んでください</Text>
            {matches.length === 0 ? (
              <Text className="text-[13px] text-brand-500">照合できませんでした。一覧から選んでください（写真は証跡として保存されます）</Text>
            ) : (
              <Text className="text-[13px] text-brand-500">複数の候補があります。一覧から選んでください</Text>
            )}
          </View>
          <ScrollView className="flex-1 px-6" contentContainerClassName="gap-2 pb-8">
            {vehicles.map((v) => (
              <Pressable
                key={v.id}
                className="border border-brand-200 rounded-lg py-3 px-4 active:opacity-70"
                onPress={() => confirmPlateVehicle(v)}
                disabled={busy}
              >
                <Text className="text-base text-brand-900 font-medium">{plateLabel(v)}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <Pressable className="py-3 items-center border-t border-brand-100" onPress={onClose} disabled={busy}>
            <Text className="text-brand-400 font-medium">やめる</Text>
          </Pressable>
        </View>
      )}

      {step === "manual-reason" && (
        <View className="flex-1 bg-white p-6 pt-16 gap-4">
          <Text className="text-xl font-bold text-brand-900">手動申請の理由</Text>
          <Text className="text-[13px] text-brand-500">運営の承認があるまで、この打刻は保留になります。</Text>
          <TextInput
            className="border border-brand-200 rounded-lg px-3 py-2.5 text-base bg-white text-brand-900 min-h-[90px]"
            value={reason}
            onChangeText={setReason}
            placeholder="例: QRラベルが破損していて読み取れない"
            multiline
            textAlignVertical="top"
          />
          <Pressable
            className={`bg-accent-500 rounded-lg py-3.5 items-center active:opacity-80 mt-2 ${!reason.trim() ? "opacity-40" : ""}`}
            onPress={() => setStep("manual-pick")}
            disabled={!reason.trim()}
          >
            <Text className="text-white font-semibold text-base">次へ（車両を選ぶ）</Text>
          </Pressable>
          <Pressable className="py-2 items-center" onPress={onClose}>
            <Text className="text-brand-400 font-medium">やめる</Text>
          </Pressable>
        </View>
      )}

      {step === "manual-pick" && (
        <View className="flex-1 bg-white pt-16">
          <View className="px-6 pb-3">
            <Text className="text-xl font-bold text-brand-900">車両を選んでください</Text>
          </View>
          <ScrollView className="flex-1 px-6" contentContainerClassName="gap-2 pb-8">
            {vehicles.map((v) => (
              <Pressable
                key={v.id}
                className="border border-brand-200 rounded-lg py-3 px-4 active:opacity-70"
                onPress={() => submitManual(v)}
              >
                <Text className="text-base text-brand-900 font-medium">{plateLabel(v)}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <Pressable className="py-3 items-center border-t border-brand-100" onPress={onClose}>
            <Text className="text-brand-400 font-medium">やめる</Text>
          </Pressable>
        </View>
      )}
    </Modal>
  );
}
