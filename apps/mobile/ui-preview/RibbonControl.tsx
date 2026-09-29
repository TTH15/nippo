// @refresh reset
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AccessibilityInfo, Animated, AppState, Easing, Image, PanResponder, Text, View } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { AppIcon } from "../src/components/AppIcon";
import { playRibbonFeedback } from "./haptics";
import { useHapticPreferences } from "./HapticPreferences";
import { createRibbonFeedback } from "./ribbon-feedback";

export type RibbonOrigin = { x: number; y: number; width: number; height: number };
export function RibbonControl({ mode, onOpen, onInteractionChange }: { mode: "start" | "end"; onOpen: (origin: RibbonOrigin) => void; onInteractionChange?: (active: boolean) => void }) {
  const focused = useIsFocused(), track = useRef<View>(null);
  const progress = useRef(new Animated.Value(0)).current;
  const travel = useRef(0), current = useRef(0), opening = useRef(false), cancelled = useRef(false), alive = useRef(true);
  const callback = useRef(onOpen); callback.current = onOpen;
  const reduced = useRef(false), generation = useRef(0);
  const { enabled } = useHapticPreferences();
  const hapticsEnabled = useRef(enabled); hapticsEnabled.current = enabled;
  const interacting = useRef(false);
  const interaction = useRef(onInteractionChange); interaction.current = onInteractionChange;
  const setInteracting = (active: boolean) => { if (interacting.current !== active) { interacting.current = active; interaction.current?.(active); } };
  const feedback = useRef(createRibbonFeedback(kind => {
    void playRibbonFeedback(kind).catch(() => {});
  }, () => hapticsEnabled.current && alive.current && AppState.currentState === "active")).current;
  const reset = () => { generation.current++; setInteracting(false); cancelled.current = true; current.current = 0; progress.stopAnimation(); progress.setValue(0); };
  const open = () => {
    if (opening.current || !track.current) return;
    opening.current = true;
    setInteracting(false);
    const ticket = generation.current;
    track.current.measureInWindow((x, y, width, height) => {
      if (!alive.current || ticket !== generation.current || AppState.currentState !== "active" || !width || !height) { opening.current = false; reset(); return; }
      feedback.release();
      callback.current({ x, y, width, height });
    });
  };
  const openRef = useRef(open); openRef.current = open;
  const responder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => !opening.current,
    onMoveShouldSetPanResponder: (_e, g) => !opening.current && g.numberActiveTouches === 1 && g.dx > 7 && Math.abs(g.dx) > Math.abs(g.dy) * 1.3,
    onPanResponderGrant: () => { cancelled.current = false; progress.stopAnimation(); setInteracting(true); feedback.start(); },
    onPanResponderMove: (_e, g) => {
      if (cancelled.current || opening.current) return;
      if (g.numberActiveTouches !== 1) { reset(); return; }
      current.current = Math.max(0, Math.min(travel.current, g.dx)); progress.setValue(current.current);
      if (travel.current > 0) feedback.move(current.current / travel.current);
    },
    onPanResponderRelease: (_e, g) => {
      setInteracting(false);
      if (!cancelled.current && !opening.current && travel.current > 0 && Math.max(0, g.dx) / travel.current >= .94) openRef.current();
      else { current.current = 0; Animated.timing(progress, { toValue: 0, duration: reduced.current ? 0 : 140, useNativeDriver: false }).start(); }
    },
    onPanResponderTerminate: reset,
    onPanResponderTerminationRequest: () => false,
    onShouldBlockNativeResponder: () => true,
  })).current;
  useEffect(() => {
    alive.current = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(v => { if (alive.current) reduced.current = v; });
    const motion = AccessibilityInfo.addEventListener("reduceMotionChanged", v => { reduced.current = v; });
    const app = AppState.addEventListener("change", state => { if (state !== "active") reset(); });
    return () => { alive.current = false; setInteracting(false); progress.stopAnimation(); motion.remove(); app.remove(); };
  }, []);
  useEffect(() => { opening.current = false; reset(); }, [focused]);
  return <View style={{ width: "100%" }}>
    <View ref={track} collapsable={false} testID={`ribbon-track-${mode}`} onLayout={e => { travel.current = Math.max(0, e.nativeEvent.layout.width - 72); reset(); }} style={{ height: 72, borderRadius: 36, borderWidth: 1, borderColor: "#FFFFFFAA", overflow: "hidden", experimental_backgroundImage: mode === "start" ? "linear-gradient(135deg,#FFFFFFD9,#DCE4ED99)" : "linear-gradient(135deg,#FFFFFF38,#FFFFFF12)" }}>
      <Animated.View pointerEvents="none" style={{ position: "absolute", left: 28, top: 9, height: 54, width: Animated.add(progress, 8), opacity: progress.interpolate({ inputRange: [0, 8], outputRange: [0, 1], extrapolate: "clamp" }) }}><Image source={require("./assets/ribbon-band.png")} resizeMode="stretch" style={{ width: "100%", height: "100%" }} /></Animated.View>
      <View pointerEvents="none" style={{ position: "absolute", left: 26, top: 28, width: 16, height: 16, borderRadius: 8, backgroundColor: "#F6C648" }} />
      <Animated.View pointerEvents="none" style={{ position: "absolute", left: 70, right: 14, top: 0, bottom: 0, justifyContent: "center", alignItems: "center", opacity: progress.interpolate({ inputRange: [0, 110], outputRange: [1, 0], extrapolate: "clamp" }) }}><Text style={{ color: mode === "start" ? "#35445A" : "white", fontSize: 15, fontWeight: "600" }}>{mode === "start" ? "スライドで開始" : "スライドで終了"}</Text></Animated.View>
      <Animated.View {...responder.panHandlers} testID={`ribbon-${mode}`} accessible accessibilityRole="button" accessibilityLabel={`右へスライドして${mode === "start" ? "開始" : "終了"}の撮影へ`} accessibilityActions={[{ name: "activate", label: "撮影を開く" }]} onAccessibilityAction={e => { if (e.nativeEvent.actionName === "activate") open(); }} style={{ position: "absolute", left: 6, top: 6, transform: [{ translateX: progress }], width: 58, height: 58, borderRadius: 29, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#FFF4B9", experimental_backgroundImage: "linear-gradient(145deg,#FFE889,#FFC52C 62%,#F2B927)" }}><AppIcon name="chevron-right" size={21} color="#29374A" /></Animated.View>
    </View>
  </View>;
}

// タブを含む全画面を一枚としてフェードする。領域の拡大で下端だけ遅れて覆わない。
export function CaptureReveal({ origin, children }: { origin?: RibbonOrigin; children: ReactNode }) {
  const opacity = useRef(new Animated.Value(origin ? 0 : 1)).current;
  const [ready, setReady] = useState(!origin);
  useEffect(() => {
    if (!origin) return;
    let alive = true;
    const finish = () => { opacity.stopAnimation(); opacity.setValue(1); if (alive) setReady(true); };
    void AccessibilityInfo.isReduceMotionEnabled().then(reduce => {
      if (!alive) return;
      if (reduce) finish();
      else Animated.timing(opacity, { toValue: 1, duration: 250, easing: Easing.bezier(.22, 1, .36, 1), useNativeDriver: true }).start(({ finished }) => { if (alive && finished) setReady(true); });
    });
    const listener = AccessibilityInfo.addEventListener("reduceMotionChanged", reduce => { if (reduce) finish(); });
    return () => { alive = false; opacity.stopAnimation(); listener.remove(); };
  }, [origin, opacity]);
  return <Animated.View testID="capture-reveal" style={{ flex: 1, backgroundColor: "#08090B", opacity }}>
    <View pointerEvents={ready ? "auto" : "none"} accessibilityElementsHidden={!ready} importantForAccessibility={ready ? "auto" : "no-hide-descendants"} style={{ flex: 1 }}>{children}</View>
  </Animated.View>;
}
