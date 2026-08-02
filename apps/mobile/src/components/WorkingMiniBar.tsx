import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FontAwesome6 } from "@expo/vector-icons";
import Animated, {
  FadeInDown,
  FadeOutDown,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { useWorkSession } from "../WorkSessionContext";
import { formatDuration } from "../format";

// Spotify のミニプレイヤー式「稼働中バー」（ホーム設計 P1: 業務中モード）。
// 稼働中にホーム以外のスタック画面（シフト・報酬・通知・マイページ）の下部に浮かび、
// タップでホーム（稼働中カード）へ戻る。表示するルート・モードの判定は App 側で行う。
export function WorkingMiniBar({ onPress }: { onPress: () => void }) {
  const { open, vehicles } = useWorkSession();
  const insets = useSafeAreaInsets();
  const [nowTick, setNowTick] = useState(() => Date.now());

  useEffect(() => {
    if (!open) return;
    setNowTick(Date.now());
    const id = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [open]);

  // 稼働中を示すアンバードットの明滅。
  const pulse = useSharedValue(1);
  useEffect(() => {
    pulse.value = withRepeat(
      withSequence(withTiming(0.25, { duration: 800 }), withTiming(1, { duration: 800 })),
      -1,
      false,
    );
  }, [pulse]);
  const dotStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  if (!open) return null;

  const vehicle = vehicles.find((v) => v.id === open.vehicle_id);
  const plate = vehicle
    ? [vehicle.number_class, vehicle.number_hiragana, vehicle.number_numeric].filter(Boolean).join(" ")
    : "";
  const elapsed = open.started_at ? nowTick - new Date(open.started_at).getTime() : 0;

  return (
    <Animated.View
      entering={FadeInDown.duration(250)}
      exiting={FadeOutDown.duration(200)}
      style={{ position: "absolute", left: 12, right: 12, bottom: insets.bottom + 10 }}
    >
      <Pressable
        onPress={onPress}
        className="bg-brand-900 rounded-2xl px-4 py-3 flex-row items-center gap-3 shadow-lg active:opacity-90"
      >
        <Animated.View style={dotStyle} className="w-2.5 h-2.5 rounded-full bg-accent-400" />
        <View className="flex-1">
          <Text className="text-accent-400 text-[11px] font-semibold">稼働中</Text>
          <Text className="text-white text-[15px] font-bold">{formatDuration(elapsed)}</Text>
        </View>
        {!!plate && <Text className="text-brand-300 text-[12px]">{plate}</Text>}
        <FontAwesome6 name="chevron-right" size={12} color="#7c848f" iconStyle="solid" />
      </Pressable>
    </Animated.View>
  );
}
