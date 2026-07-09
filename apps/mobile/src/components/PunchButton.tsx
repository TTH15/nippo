import { useEffect, useRef, useState } from "react";
import { Pressable, Text, useWindowDimensions, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import Animated, {
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

// ハコ虎の「業務開始プロトコル」の中核部品。
// 1つの円が 稼働開始/終了 → 長押し充填 → 円形カメラ(QR) → 完了チェック、と状態変化する。
// 画面遷移はしない（docs/qr_flow.md v2.0）。
const SIZE = 176;
const HOLD_MS = 800;
const GROW_MS = 260;

type ButtonState = "idle" | "pressing" | "camera" | "success";

export function PunchButton({
  mode,
  busy,
  onScanned,
}: {
  mode: "start" | "end";
  busy: boolean;
  // QR読み取り成功時に呼ばれる。戻り値 true=認証成功（成功演出へ）/ false=失敗（idleへ戻す。エラー表示は呼び出し側の責務）
  onScanned: (data: string) => Promise<boolean>;
}) {
  const { width } = useWindowDimensions();
  // カメラ状態では読み取りやすいよう円を大きく広げる。長押しした指が自然に退く広さを確保する。
  const cameraSize = Math.min(width - 48, 320);

  const [state, setState] = useState<ButtonState>("idle");
  const [permission, requestPermission] = useCameraPermissions();
  const handledRef = useRef(false);
  const progress = useSharedValue(0);
  const size = useSharedValue(SIZE);

  useEffect(() => {
    if (state === "camera") {
      handledRef.current = false;
      if (permission && !permission.granted && permission.canAskAgain) requestPermission();
    }
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleFillComplete() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    size.value = withTiming(cameraSize, { duration: GROW_MS });
    setState("camera");
  }

  function onPressIn() {
    if (busy || state !== "idle") return;
    setState("pressing");
    progress.value = withTiming(1, { duration: HOLD_MS }, (finished) => {
      if (finished) runOnJS(handleFillComplete)();
    });
  }

  function onPressOut() {
    if (state !== "pressing") return;
    cancelAnimation(progress);
    progress.value = withTiming(0, { duration: 150 });
    setState("idle");
  }

  function resetToIdle() {
    progress.value = 0;
    size.value = withTiming(SIZE, { duration: GROW_MS });
    setState("idle");
  }

  async function handleBarcodeScanned(data: string) {
    if (handledRef.current) return;
    handledRef.current = true;
    const ok = await onScanned(data);
    if (ok) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setState("success");
      setTimeout(resetToIdle, 500);
    } else {
      resetToIdle();
    }
  }

  const fillStyle = useAnimatedStyle(() => ({
    transform: [{ scale: progress.value }],
  }));

  const containerStyle = useAnimatedStyle(() => ({
    width: size.value,
    height: size.value,
    borderRadius: size.value / 2,
  }));

  const caption =
    state === "camera"
      ? "QRを読み取ってください"
      : state === "success"
        ? "読み取り完了"
        : mode === "start"
          ? "長押しで稼働開始"
          : "長押しで稼働終了";

  return (
    <View className="items-center gap-3">
      <Animated.View
        style={containerStyle}
        className="items-center justify-center overflow-hidden bg-brand-900"
      >
        <Pressable
          onPressIn={onPressIn}
          onPressOut={onPressOut}
          disabled={busy || state === "camera" || state === "success"}
          style={{ width: "100%", height: "100%" }}
          className="items-center justify-center"
        >
          {state === "camera" ? (
            permission?.granted ? (
              <CameraView
                style={{ width: "100%", height: "100%" }}
                barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                onBarcodeScanned={({ data }) => handleBarcodeScanned(data)}
              />
            ) : (
              <Pressable
                onPress={() => requestPermission()}
                className="items-center justify-center px-4"
                style={{ width: "100%", height: "100%" }}
              >
                <Text className="text-white text-center text-[13px]">
                  カメラを許可してください
                </Text>
              </Pressable>
            )
          ) : state === "success" ? (
            <View className="items-center justify-center bg-accent-500" style={{ width: "100%", height: "100%" }}>
              <Text className="text-white text-5xl font-bold">✓</Text>
            </View>
          ) : (
            <>
              <Animated.View
                pointerEvents="none"
                className="absolute bg-accent-500"
                style={[{ width: SIZE, height: SIZE, borderRadius: SIZE / 2 }, fillStyle]}
              />
              <Text className="text-white text-lg font-bold">
                {mode === "start" ? "稼働開始" : "稼働終了"}
              </Text>
            </>
          )}
        </Pressable>
      </Animated.View>
      <Text className="text-brand-500 text-[13px]">{caption}</Text>
    </View>
  );
}
