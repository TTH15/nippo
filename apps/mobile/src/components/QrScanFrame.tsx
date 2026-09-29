import { useEffect, useRef } from "react";
import { AccessibilityInfo, Animated, View } from "react-native";
import { FontAwesome6 } from "@expo/vector-icons";
import type { QrMotionTarget } from "../capture/qr-geometry";

export type QrFrameState = "searching" | "verifying" | "verified" | "rejected";
const resting = [{ x: 78, y: 78 }, { x: 122, y: 78 }, { x: 78, y: 122 }];
const defaultTarget: QrMotionTarget = { box: { x: 0, y: 0, width: 232, height: 232, angleDeg: 0 }, corners: [{ x: 0, y: 0 }, { x: 232, y: 0 }, { x: 232, y: 232 }, { x: 0, y: 232 }], finders: [{ x: 35, y: 35 }, { x: 197, y: 35 }, { x: 35, y: 197 }] };
const line = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  const width = Math.hypot(b.x - a.x, b.y - a.y);
  return { x: (a.x + b.x - width) / 2, y: (a.y + b.y) / 2 - 2.5, width, angle: Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI };
};
const restingLines = defaultTarget.corners.map((point, index) => line(point, defaultTarget.corners[(index + 1) % 4]));

export function QrScanFrame({ state, target }: { state: QrFrameState; target?: QrMotionTarget | null }) {
  const values = useRef({
    x: new Animated.Value(0), y: new Animated.Value(0), width: new Animated.Value(232), height: new Animated.Value(232), radius: new Animated.Value(0), angle: new Animated.Value(0),
    finders: resting.map(point => ({ x: new Animated.Value(point.x), y: new Animated.Value(point.y) })),
    finderSize: new Animated.Value(32),
    markersOpacity: new Animated.Value(1), checkOpacity: new Animated.Value(0), checkScale: new Animated.Value(.5),
    borderOpacity: new Animated.Value(1), linesOpacity: new Animated.Value(0),
    lines: restingLines.map(item => ({ x: new Animated.Value(item.x), y: new Animated.Value(item.y), width: new Animated.Value(item.width), angle: new Animated.Value(item.angle) })),
  }).current;
  const reducedMotion = useRef(false);
  useEffect(() => { AccessibilityInfo.isReduceMotionEnabled().then(value => { reducedMotion.current = value; }).catch(() => {}); }, []);
  useEffect(() => {
    const destination = target ?? defaultTarget;
    const { box, finders, corners } = destination;
    const finderSize = Math.max(22, Math.min(38, Math.min(box.width, box.height) * .16));
    const duration = reducedMotion.current ? 0 : 340;
    const move = (value: Animated.Value, toValue: number, ms = duration) => Animated.timing(value, { toValue, duration: ms, useNativeDriver: false });
    const moveTarget = () => Animated.parallel([
      move(values.x, box.x), move(values.y, box.y), move(values.width, box.width), move(values.height, box.height),
      move(values.radius, 0), move(values.angle, box.angleDeg), move(values.finderSize, finderSize),
      ...values.finders.flatMap((value, index) => [move(value.x, finders[index].x - finderSize / 2), move(value.y, finders[index].y - finderSize / 2)]),
      move(values.markersOpacity, 1), move(values.checkOpacity, 0), move(values.checkScale, .5),
      move(values.borderOpacity, target ? 0 : 1), move(values.linesOpacity, target ? 1 : 0),
      ...values.lines.flatMap((value, index) => { const edge = line(corners[index], corners[(index + 1) % 4]); const base = restingLines[index].angle; const shortestAngle = base + ((edge.angle - base + 540) % 360) - 180; return [move(value.x, edge.x), move(value.y, edge.y), move(value.width, edge.width), move(value.angle, shortestAngle)]; }),
    ]);
    let animation: Animated.CompositeAnimation;
    if (state === "searching" || state === "rejected") {
      animation = Animated.parallel([
        move(values.x, 0, 180), move(values.y, 0, 180), move(values.width, 232, 180), move(values.height, 232, 180), move(values.radius, 0, 180), move(values.angle, 0, 180),
        move(values.finderSize, 32, 180),
        ...values.finders.flatMap((value, index) => [move(value.x, resting[index].x, 180), move(value.y, resting[index].y, 180)]),
        move(values.markersOpacity, 1, 180), move(values.checkOpacity, 0, 180), move(values.checkScale, .5, 180),
        move(values.borderOpacity, 1, 180), move(values.linesOpacity, 0, 180),
        ...values.lines.flatMap((value, index) => [move(value.x, restingLines[index].x, 180), move(value.y, restingLines[index].y, 180), move(value.width, restingLines[index].width, 180), move(value.angle, restingLines[index].angle, 180)]),
      ]);
    } else if (state === "verifying") {
      animation = moveTarget();
    } else {
      const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      animation = Animated.sequence([
        moveTarget(),
        Animated.parallel([
          move(values.x, center.x - 54, 420), move(values.y, center.y - 54, 420), move(values.width, 108, 420), move(values.height, 108, 420), move(values.radius, 54, 420), move(values.angle, 0, 420),
          move(values.markersOpacity, 0, 180), move(values.checkOpacity, 1, 360), move(values.checkScale, 1, 420),
          move(values.borderOpacity, 1, 420), move(values.linesOpacity, 0, 200),
        ]),
      ]);
    }
    animation.start();
    return () => animation.stop();
  }, [state, target, values]);
  const color = state === "verified" ? "#51E8A7" : state === "rejected" ? "#FFB4B4" : state === "verifying" ? "#FFD45C" : "#FFFFFF";
  return <View accessible={false} pointerEvents="none" style={{ width: 232, height: 232 }}>
    <Animated.View style={{ position: "absolute", left: values.x, top: values.y, width: values.width, height: values.height, borderRadius: values.radius, borderWidth: state === "verified" ? 6 : 4, borderColor: color, opacity: values.borderOpacity, transform: [{ rotate: values.angle.interpolate({ inputRange: [-180, 180], outputRange: ["-180deg", "180deg"] }) }] }} />
    {values.lines.map((edge, index) => <Animated.View key={index} style={{ position: "absolute", left: edge.x, top: edge.y, width: edge.width, height: 5, backgroundColor: color, opacity: values.linesOpacity, transform: [{ rotate: edge.angle.interpolate({ inputRange: [-360, 360], outputRange: ["-360deg", "360deg"] }) }] }} />)}
    {values.finders.map((point, index) => <Animated.View key={index} style={{ position: "absolute", left: point.x, top: point.y, width: values.finderSize, height: values.finderSize, borderRadius: 5, backgroundColor: state === "verified" ? "#51E8A7" : "#E5EEF5", alignItems: "center", justifyContent: "center", opacity: values.markersOpacity }}><View style={{ width: "35%", height: "35%", backgroundColor: "#202B36" }} /></Animated.View>)}
    <Animated.View style={{ position: "absolute", left: Animated.add(values.x, Animated.divide(Animated.subtract(values.width, 58), 2)), top: Animated.add(values.y, Animated.divide(Animated.subtract(values.height, 58), 2)), width: 58, height: 58, alignItems: "center", justifyContent: "center", opacity: values.checkOpacity, transform: [{ scale: values.checkScale }] }}><FontAwesome6 name="check" size={56} color="#51E8A7" iconStyle="solid" style={{ textShadowColor: "#14212B", textShadowRadius: 5, textShadowOffset: { width: 0, height: 1 } }} /></Animated.View>
  </View>;
}
