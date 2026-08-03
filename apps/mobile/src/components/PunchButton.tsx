import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { FontAwesome6 } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Animated, {
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

// ハコ虎の「業務開始プロトコル」の起点（docs/qr_flow.md v2.0）。
// 長押しで充填 → 完了で全画面キャプチャ（CaptureFlow）へ引き渡す。
// 撮影UIは 2026-08-03 に CaptureFlow へ集約したため、この円は
// 「トリガー＋状態アンカー」に徹する（円の中にカメラは出さない）。
const SIZE = 176;
const HOLD_MS = 800;

type ButtonState = "idle" | "pressing";

export function PunchButton({
  mode,
  busy,
  onTriggered,
  iconOnly = false,
  showCaption = true,
}: {
  mode: "start" | "end";
  busy: boolean;
  /** 長押し充填が完了したとき。呼び出し側が全画面キャプチャを開く */
  onTriggered: () => void;
  /** true なら待機時の円をテキストでなく手のアイコンにする（カード側にタイトルがある場合の重複回避） */
  iconOnly?: boolean;
  /** false なら円下のキャプションを出さない */
  showCaption?: boolean;
}) {
  const [state, setState] = useState<ButtonState>("idle");
  const progress = useSharedValue(0);

  function handleFillComplete() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    progress.value = 0;
    setState("idle");
    onTriggered();
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

  const fillStyle = useAnimatedStyle(() => ({
    transform: [{ scale: progress.value }],
  }));

  const caption = mode === "start" ? "長押しで稼働開始" : "長押しで稼働終了";

  return (
    <View className="items-center gap-3">
      <View
        className="items-center justify-center overflow-hidden bg-brand-900"
        style={{ width: SIZE, height: SIZE, borderRadius: SIZE / 2 }}
      >
        <Pressable
          onPressIn={onPressIn}
          onPressOut={onPressOut}
          disabled={busy}
          style={{ width: "100%", height: "100%" }}
          className="items-center justify-center"
        >
          <Animated.View
            pointerEvents="none"
            className="absolute bg-accent-500"
            style={[{ width: SIZE, height: SIZE, borderRadius: SIZE / 2 }, fillStyle]}
          />
          {iconOnly ? (
            <FontAwesome6 name="hand-pointer" size={44} color="#ffffff" iconStyle="solid" />
          ) : (
            <Text className="text-white text-lg font-bold">{mode === "start" ? "稼働開始" : "稼働終了"}</Text>
          )}
        </Pressable>
      </View>
      {showCaption && <Text className="text-brand-500 text-[13px]">{caption}</Text>}
    </View>
  );
}
