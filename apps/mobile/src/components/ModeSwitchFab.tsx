import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FontAwesome6 } from "@expo/vector-icons";

// 運営モードへの切り替えボタン。capabilities を1つでも持つアカウント（運営権限あり）にのみ表示。
// タップでドライバー画面⇄運営画面の簡易モードを切り替える（画面構成の刷新はM-D統合時に行う）。
export function ModeSwitchFab({ adminMode, onToggle }: { adminMode: boolean; onToggle: () => void }) {
  const insets = useSafeAreaInsets();

  return (
    <View style={{ position: "absolute", right: 16, bottom: insets.bottom + 76 }}>
      <Pressable
        onPress={onToggle}
        className={`flex-row items-center gap-2 pl-3 pr-4 py-2.5 rounded-full shadow-lg active:opacity-80 ${adminMode ? "bg-brand-900" : "bg-accent-500"}`}
      >
        <FontAwesome6 name={adminMode ? "user" : "user-shield"} size={14} color={adminMode ? "#fff" : "#15181c"} iconStyle="solid" />
        <Text className={`text-[12px] font-semibold ${adminMode ? "text-white" : "text-brand-900"}`}>
          {adminMode ? "ドライバー画面へ" : "運営画面へ"}
        </Text>
      </Pressable>
    </View>
  );
}
