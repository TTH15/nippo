import { useEffect, useRef } from "react";
import { Animated, type ViewStyle, type StyleProp } from "react-native";

// ローディング中のプレースホルダー。Web版 lib/components/Skeleton.tsx（animate-pulse）に相当。
// NativeWindのanimate-pulseは信頼できないためAnimated APIで明滅させる。
export function Skeleton({ className, style }: { className?: string; style?: StyleProp<ViewStyle> }) {
  const opacity = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.5, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return <Animated.View className={`bg-brand-100 rounded ${className ?? ""}`} style={[{ opacity }, style]} />;
}
