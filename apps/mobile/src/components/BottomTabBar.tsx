import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FontAwesome6 } from "@expo/vector-icons";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";

// Web版 UserBottomNav（apps/web/src/lib/components/UserBottomNav.tsx）を踏襲。
// 中央のタブだけ大きい円形ボタンにして目立たせる。
const ICONS: Record<string, React.ComponentProps<typeof FontAwesome6>["name"]> = {
  シフト: "calendar-days",
  業務: "truck",
  報酬: "gift",
  日報承認: "clipboard-check",
  売上: "chart-line",
  ドライバー: "address-book",
  車両: "car",
};

const CENTER_ROUTE = "業務";

export function BottomTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{ paddingBottom: insets.bottom }}
      className="flex-row items-end bg-white border-t border-brand-100"
    >
      {state.routes.map((route, index) => {
        const isFocused = state.index === index;
        const icon = ICONS[route.name] ?? "circle";
        const isCenter = route.name === CENTER_ROUTE;

        const onPress = () => {
          const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
          if (!isFocused && !event.defaultPrevented) navigation.navigate(route.name);
        };

        if (isCenter) {
          return (
            <View key={route.key} className="flex-1 items-center justify-end pb-1.5 h-16">
              <Pressable onPress={onPress} className="items-center active:opacity-80">
                <View
                  className={`w-14 h-14 rounded-full items-center justify-center shadow-md ${isFocused ? "bg-accent-600" : "bg-accent-500"}`}
                >
                  <FontAwesome6 name={icon} size={20} color="#15181c" iconStyle="solid" />
                </View>
                <Text className={`text-[10px] mt-1 font-semibold ${isFocused ? "text-accent-600" : "text-brand-500"}`}>
                  {route.name}
                </Text>
              </Pressable>
            </View>
          );
        }

        return (
          <Pressable
            key={route.key}
            onPress={onPress}
            className="flex-1 h-16 items-center justify-center gap-1 active:opacity-70"
          >
            <FontAwesome6 name={icon} size={18} color={isFocused ? "#d97706" : "#7c848f"} iconStyle="solid" />
            <Text className={`text-[10px] ${isFocused ? "text-accent-600 font-semibold" : "text-brand-500"}`}>
              {route.name}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
