import { useEffect, useState } from "react";
import { Image, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

// ヒーローカードの主役ビジュアル（ホーム設計 P1）。
// リアルタイム3Dは電池・ネイティブ依存に見合わないため不採用とし、
// 地図と同じ truck.glb をブランドアンバーに再着色して事前レンダした透過PNGを敷き、
// その上に「段ボール箱がリアハッチへ流れ込む」reanimated ループアニメを重ねる。
// 画像は左後方3/4視点（リアシャッターが左側）なので、箱は左から右へ流れて車体に消える。

const VAN_W = 132;
const VAN_H = Math.round((VAN_W * 710) / 1080); // 事前レンダ画像 1080x710 の実比率

const TRAVEL_MS = 2600;
const CYCLE_MS = TRAVEL_MS + 400; // 箱1個の周期（走行＋間）
const BOXES = [
  { size: 20, delay: 0, tint: "#d9a05b" },
  { size: 15, delay: 950, tint: "#c8955e" },
  { size: 17, delay: 1800, tint: "#e2ad6c" },
];

function LoadingBox({ size, delay, tint, dist }: { size: number; delay: number; tint: string; dist: number }) {
  const p = useSharedValue(0);

  useEffect(() => {
    p.value = 0;
    p.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(1, { duration: TRAVEL_MS, easing: Easing.inOut(Easing.quad) }),
          withTiming(0, { duration: CYCLE_MS - TRAVEL_MS }),
        ),
        -1,
        false,
      ),
    );
    return () => cancelAnimation(p);
  }, [p, delay, dist]);

  const style = useAnimatedStyle(() => {
    // 3回の小さなホップで「運ばれていく」感を出し、ハッチ手前でフェードアウト＝積み込み完了。
    const hop = -6 * Math.abs(Math.sin(p.value * Math.PI * 3));
    return {
      opacity: interpolate(p.value, [0, 0.05, 0.8, 0.94, 1], [0, 1, 1, 0, 0]),
      transform: [
        { translateX: interpolate(p.value, [0, 1], [0, dist]) },
        { translateY: hop },
        { scale: interpolate(p.value, [0, 1], [1, 0.85]) },
      ],
    };
  });

  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          left: 6,
          bottom: 12,
          width: size,
          height: size,
          borderRadius: 3,
          backgroundColor: tint,
          borderWidth: 1,
          borderColor: "#00000018",
        },
        style,
      ]}
    >
      {/* 梱包テープ */}
      <View
        style={{
          position: "absolute",
          left: "50%",
          marginLeft: -1.5,
          top: 0,
          bottom: 0,
          width: 3,
          backgroundColor: "#ffffff59",
        }}
      />
    </Animated.View>
  );
}

export function HeroVan() {
  const [stageWidth, setStageWidth] = useState(0);
  // 箱の終点: バンのリアシャッター（画像左端）を少し越えた位置。車体の下に潜り込みつつ消える。
  const dist = stageWidth - VAN_W + 30;

  return (
    <View style={{ height: VAN_H + 16 }} onLayout={(e) => setStageWidth(e.nativeEvent.layout.width)}>
      {/* 地面の影 */}
      <View
        style={{
          position: "absolute",
          right: 4,
          bottom: 6,
          width: VAN_W - 16,
          height: 12,
          borderRadius: 999,
          backgroundColor: "#15181c0f",
        }}
      />
      {stageWidth > 0 && BOXES.map((b) => <LoadingBox key={b.size} {...b} dist={dist} />)}
      {/* 箱より後に描画してリアハッチ側で箱を隠す（＝積み込まれて見える） */}
      <Image
        source={require("../../assets/van-amber.png")}
        style={{ position: "absolute", right: 0, bottom: 10, width: VAN_W, height: VAN_H }}
        resizeMode="contain"
      />
    </View>
  );
}
