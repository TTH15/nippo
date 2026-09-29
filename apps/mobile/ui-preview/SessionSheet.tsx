// @refresh reset
import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { AccessibilityInfo, Animated, AppState, PanResponder, View } from "react-native";

export function SessionSheet({ children, top, ribbonActive, scrollOffset, onClose, onHeight, onDragging }: {
  children: ReactNode; top: number; ribbonActive: RefObject<boolean>; scrollOffset: RefObject<number>;
  onClose: () => void; onHeight: (height: number) => void; onDragging: (active: boolean) => void;
}) {
  const y = useRef(new Animated.Value(0)).current;
  const callbacks = useRef({ onClose, onDragging }); callbacks.current = { onClose, onDragging };
  const reduced = useRef(false), active = useRef(false);
  const finish = () => { active.current = false; callbacks.current.onDragging(false); };
  const reset = () => { finish(); y.stopAnimation(); Animated.timing(y, { toValue: 0, duration: reduced.current ? 0 : 180, useNativeDriver: true }).start(); };
  const gesture = useRef(PanResponder.create({
    // リボンは自身でtouch開始から確保。画面の縦スクロールが先頭にある時だけ閉じる方向へ追従する。
    onMoveShouldSetPanResponderCapture: (_e, g) => !ribbonActive.current && scrollOffset.current <= 1 && g.numberActiveTouches === 1 && g.dy > 12 && g.dy > Math.abs(g.dx) * 1.3,
    onPanResponderGrant: () => { active.current = true; y.stopAnimation(); callbacks.current.onDragging(true); },
    onPanResponderMove: (_e, g) => {
      if (!active.current) return;
      if (g.numberActiveTouches !== 1) { reset(); return; }
      y.setValue(Math.max(0, g.dy));
    },
    onPanResponderRelease: (_e, g) => {
      if (active.current && (g.dy > 110 || (g.dy > 40 && g.vy > .8))) { finish(); callbacks.current.onClose(); }
      else reset();
    },
    onPanResponderTerminate: reset,
    onPanResponderTerminationRequest: () => false,
  })).current;
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (mounted) reduced.current = value; });
    const motion = AccessibilityInfo.addEventListener("reduceMotionChanged", value => { reduced.current = value; });
    const app = AppState.addEventListener("change", state => { if (state !== "active") { finish(); y.stopAnimation(); y.setValue(0); } });
    return () => { mounted = false; finish(); y.stopAnimation(); motion.remove(); app.remove(); };
  }, []);
  return <View style={{ flex: 1, paddingTop: top, backgroundColor: "#00000033" }}>
    <Animated.View {...gesture.panHandlers} testID="active-session-sheet" onLayout={event => onHeight(event.nativeEvent.layout.height)} style={{ flex: 1, borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: "hidden", transform: [{ translateY: y }] }}>{children}</Animated.View>
  </View>;
}
