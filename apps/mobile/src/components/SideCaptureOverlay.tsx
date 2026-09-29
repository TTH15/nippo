import { useEffect, useRef, useState, type ReactNode } from "react";
import { AccessibilityInfo, Animated, AppState, Image, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppIcon } from "./AppIcon";
import { CaptureActions } from "./CaptureActions";
import { VanGuideOutline } from "./VanGuideOutline";
import type { CaptureRotation } from "../capture/orientation";

function TurnPhone() {
  const turn = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    let alive = true, reduced = false;
    let loop: Animated.CompositeAnimation | undefined;
    const update = () => {
      loop?.stop(); turn.setValue(0);
      if (!alive || reduced || AppState.currentState !== "active") return;
      loop = Animated.loop(Animated.sequence([
        Animated.delay(400), Animated.timing(turn, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.delay(700), Animated.timing(turn, { toValue: 0, duration: 450, useNativeDriver: true }),
      ])); loop.start();
    };
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (alive) { reduced = value; update(); } });
    const motion = AccessibilityInfo.addEventListener("reduceMotionChanged", value => { reduced = value; update(); });
    const app = AppState.addEventListener("change", update);
    return () => { alive = false; loop?.stop(); motion.remove(); app.remove(); };
  }, [turn]);
  return <View accessible={false} style={{ width: 160, height: 150, alignItems: "center", justifyContent: "center" }}>
    <Animated.View style={{ transform: [{ rotate: turn.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "90deg"] }) }] }}><AppIcon name="mobile-screen-button" size={90} color="#FFD45C" /></Animated.View>
    <View style={{ position: "absolute", right: 0, top: 12 }}><AppIcon name="rotate-right" size={27} color="#FFD45C" /></View>
  </View>;
}

// アプリは縦固定のまま、カメラ上の操作面だけ端末の持ち方へ合わせる。
export function SideCaptureOverlay({ angle, rotation, shot, photoUri, busy = false, error, warning, controls, onShot, onRetake, onConfirm, onCancel, unavailable = false, onManual, previewControls, onSkip }: {
  angle: "left" | "right"; rotation: CaptureRotation; shot: boolean; photoUri?: string;
  busy?: boolean; error?: string; warning?: string | null; controls?: ReactNode;
  onShot: () => void; onRetake: () => void; onConfirm: () => void; onCancel: () => void;
  unavailable?: boolean; onManual?: () => void; previewControls?: ReactNode; onSkip?: () => void;
}) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const insets = useSafeAreaInsets();
  const title = `車両の${angle === "right" ? "右" : "左"}`;
  const skip = onSkip && !shot ? <Pressable accessibilityRole="button" disabled={busy} onPress={onSkip} style={{ minHeight: 44, justifyContent: "center" }}><Text style={{ color: "#D1D6DC", fontSize: 12 }}>点検はスキップ</Text></Pressable> : null;
  const cancel = <Pressable testID="capture-cancel" accessibilityRole="button" onPress={onCancel} style={{ minHeight: 44, alignItems: "center", justifyContent: "center" }}><Text style={{ color: "#D1D6DC", fontSize: 14 }}>やめる</Text></Pressable>;
  return <View testID="side-capture" onLayout={e => setSize(e.nativeEvent.layout)} style={{ position: "absolute", inset: 0 }}>
    {!rotation ? <View testID="capture-turn-prompt" style={{ flex: 1, backgroundColor: "#08090BEE", padding: 24, paddingTop: Math.max(24, insets.top), paddingBottom: Math.max(24, insets.bottom), alignItems: "center", justifyContent: "space-between" }}>
      <Text accessibilityRole="header" style={{ color: "white", fontWeight: "700", fontSize: 23 }}>{title}</Text>
      <View style={{ alignItems: "center", gap: 24 }}><TurnPhone /><Text accessibilityRole="alert" style={{ color: "white", fontWeight: "700", fontSize: 23 }}>スマホを横向きに</Text><View style={{ width: 220, height: 100 }}><VanGuideOutline angle={angle} /></View></View>
      <View style={{ width: "100%", gap: 10 }}>{unavailable && <><Text style={{ color: "#FFE08B", textAlign: "center" }}>端末の向きを検出できません</Text><Pressable accessibilityRole="button" onPress={onManual} style={{ minHeight: 48, backgroundColor: "#FFC52C", borderRadius: 14, alignItems: "center", justifyContent: "center" }}><Text style={{ color: "#192333", fontWeight: "600" }}>横向きにして続ける</Text></Pressable></>}{previewControls}{skip}{cancel}</View>
    </View> : <View testID="capture-landscape" style={{ position: "absolute", width: size.height, height: size.width, left: (size.width - size.height) / 2, top: (size.height - size.width) / 2, transform: [{ rotate: `${rotation}deg` }], paddingHorizontal: Math.max(24, insets.top, insets.bottom), paddingVertical: 16, backgroundColor: shot ? "#08090B" : "#0004", flexDirection: "row", gap: 16 }}>
      <View style={{ flex: 1, gap: 10 }}><Text accessibilityRole="header" style={{ color: "white", fontWeight: "700", fontSize: 19 }}>{title}</Text>
        <View testID="side-viewfinder" style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>{photoUri ? <Image source={{ uri: photoUri }} resizeMode="contain" style={{ width: "100%", height: "100%" }} /> : <VanGuideOutline angle={angle} />}</View>
        {!!error && <Text accessibilityRole="alert" style={{ color: "#FFB4B4", fontSize: 13 }}>{error}</Text>}
        {!!warning && <Text accessibilityRole="alert" style={{ color: "#FFE08B", fontSize: 13 }}>{warning}</Text>}
        {shot && <CaptureActions disabled={busy} confirmTestID="capture-confirm-photo" retakeTestID="capture-photo" onRetake={onRetake} onConfirm={onConfirm} confirmLabel={warning ? "この写真で続ける" : "この写真を使う"} />}
      </View>
      <View style={{ width: 104, justifyContent: "space-between", alignItems: "center", paddingVertical: 2 }}>
        <View style={{ alignSelf: "stretch" }}>{!shot && controls}</View>
        {!shot && <Pressable testID="capture-photo" accessibilityRole="button" accessibilityLabel="写真を撮影" disabled={busy} onPress={onShot} style={{ width: 76, height: 76, borderRadius: 38, padding: 4, borderWidth: 3, borderColor: "white", opacity: busy ? .4 : 1 }}><View style={{ flex: 1, borderRadius: 34, backgroundColor: "white" }} /></Pressable>}
        <View>{skip}{cancel}</View>
      </View>
    </View>}
  </View>;
}
