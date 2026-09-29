import { useEffect, useRef, useState } from "react";
import { AppState, Pressable, Text, View } from "react-native";
import { AppIcon } from "./AppIcon";
import * as Haptics from "expo-haptics";
import { HOLD_MS } from "./hold-settings";
import Animated, {
  cancelAnimation,
  runOnJS,
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

// ハコ虎の「業務開始プロトコル」の起点（docs/qr_flow.md v2.0）。
// 長押しで充填 → 完了で全画面キャプチャ（CaptureFlow）へ引き渡す。
// 撮影UIは 2026-08-03 に CaptureFlow へ集約したため、この円は
// 「トリガー＋状態アンカー」に徹する（円の中にカメラは出さない）。
const SIZE = 176;

type ButtonState = "idle" | "pressing";

export function PunchButton({
  mode,
  busy,
  onTriggered,
  iconOnly = false,
  showCaption = true,
  size = SIZE,
  appearance = "default",
}: {
  mode: "start" | "end";
  busy: boolean;
  /** 長押し充填が完了したとき。呼び出し側が全画面キャプチャを開く */
  onTriggered: () => void;
  /** true なら待機時の円をテキストでなく手のアイコンにする（カード側にタイトルがある場合の重複回避） */
  iconOnly?: boolean;
  /** false なら円下のキャプションを出さない */
  showCaption?: boolean;
  size?: number;
  appearance?: "default" | "accent" | "danger";
}) {
  const [state, setState] = useState<ButtonState>("idle");
  const progress = useSharedValue(0);

  const pressId = useRef(0);
  const pressing = useRef(false);
  const busyRef = useRef(busy); busyRef.current = busy;

  function cancelHold() {
    pressId.current++; pressing.current = false;
    cancelAnimation(progress);
    progress.value = withTiming(0, { duration: 150, reduceMotion: ReduceMotion.Never });
    setState("idle");
  }
  useEffect(() => {
    const subscription = AppState.addEventListener("change", value => { if (value !== "active") cancelHold(); });
    return () => { subscription.remove(); pressId.current++; pressing.current = false; cancelAnimation(progress); };
  }, [progress]);
  useEffect(() => { if (busy) cancelHold(); }, [busy]);

  function handleFillComplete(id: number) {
    if (id !== pressId.current || !pressing.current || busyRef.current) return;
    pressing.current = false;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    progress.value = 0; setState("idle"); onTriggered();
  }
  function onPressIn() {
    if (busyRef.current || pressing.current) return;
    const id = ++pressId.current; pressing.current = true;
    setState("pressing"); progress.value = 0;
    // 操作に必要な800msは「視差効果を減らす」でも短縮しない。
    progress.value = withTiming(1, { duration: HOLD_MS, easing: Easing.linear, reduceMotion: ReduceMotion.Never }, finished => {
      if (finished) runOnJS(handleFillComplete)(id);
    });
  }
  function onPressOut() { if (pressing.current) cancelHold(); }
  const rightStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${Math.min(progress.value, .5) * 360}deg` }] }));
  const leftStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${180 + Math.max(0, progress.value - .5) * 360}deg` }] }));
  const ring = appearance === "accent" ? "#A96500" : appearance === "danger" ? "#FFBAC2" : "#F59E0B";
  const background = appearance === "accent" ? "#FFC52C" : appearance === "danger" ? "#E73949" : "#15181c";
  const half = size / 2;
  const caption = mode === "start" ? "長押しで稼働開始" : "長押しで稼働終了";

  return (
    <View className="items-center gap-3">
      <Pressable
        accessibilityRole="button" accessibilityLabel={caption} accessibilityState={{ disabled: busy, busy }}
        onPressIn={onPressIn} onPressOut={onPressOut} onBlur={onPressOut} disabled={busy}
        style={{ width: size, height: size, opacity: busy ? .5 : 1, alignItems: "center", justifyContent: "center" }}
      >
        <View pointerEvents="none" style={{ position: "absolute", inset: 0, borderRadius: half, borderWidth: 4, borderColor: appearance === "danger" ? "#FFFFFF33" : "#A9650026" }} />
        {/* 左右の半円をクリップして12時から時計回りに充填。native依存を増やさない。 */}
        {[rightStyle, leftStyle].map((style, index) => <View key={index} pointerEvents="none" style={{ position: "absolute", top: 0, left: index === 0 ? half : 0, width: half, height: size, overflow: "hidden" }}>
          <Animated.View style={[{ position: "absolute", top: 0, left: index === 0 ? -half : 0, width: size, height: size }, style]}>
            <View style={{ width: half, height: size, overflow: "hidden" }}>
              <View style={{ width: size, height: size, borderRadius: half, borderWidth: 4, borderColor: ring }} />
            </View>
          </Animated.View>
        </View>)}
        <View pointerEvents="none" style={{ width: size - 16, height: size - 16, borderRadius: half, backgroundColor: background, alignItems: "center", justifyContent: "center", gap: 5 }}>
          {iconOnly ? <AppIcon name="hand-pointer" size={44} color={appearance === "accent" ? "#192333" : "#fff"} iconStyle="solid" />
            : <><Text className="text-lg font-bold" style={{ color: appearance === "accent" ? "#192333" : "#fff" }}>{mode === "start" ? "稼働開始" : "稼働終了"}</Text>
              {!showCaption && <Text style={{ color: appearance === "accent" ? "#192333" : "#fff", fontSize: 12 }}>{state === "pressing" ? "そのまま" : "長押し"}</Text>}</>}
        </View>
      </Pressable>
      {showCaption && <Text className="text-brand-500 text-[13px]">{caption}</Text>}
    </View>
  );
}
