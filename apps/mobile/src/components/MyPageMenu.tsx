import { Pressable, Text, View } from "react-native";
import { AppIcon } from "./AppIcon";
export type AccountSection = "profile" | "bank" | "security";
export const accountSectionTitles = { profile: "プロフィール", bank: "振込口座", security: "ログイン・電話番号" };
export type BankStatus = "loading" | "registered" | "missing" | "error";
export function MyPageMenu({ name, code, bankStatus, onOpen, onAppSettings }: {
  name: string; code?: string; bankStatus: BankStatus; onOpen: (section: AccountSection) => void; onAppSettings?: () => void;
}) {
  const row = (label: string, icon: "sliders" | "shield-halved" | "building-columns", onPress: () => void, detail?: string, attention = false) => <Pressable testID={`account-${icon}`} accessibilityRole="button" accessibilityLabel={`${label}${detail ? `、${detail}` : ""}`} onPress={onPress} style={{ minHeight: 68, padding: 16, flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: "white", borderRadius: 16, borderWidth: 1, borderColor: "#E0E6ED" }}>
    <AppIcon name={icon} size={20} color="#526074" /><View style={{ flex: 1, gap: 5 }}><Text style={{ textAlign: "left", fontSize: 16, color: "#192333", fontWeight: "500" }}>{label}</Text>{detail && <Text style={{ textAlign: "left", fontSize: 13, color: attention ? "#92400E" : "#526074" }}>{detail}</Text>}</View><AppIcon name="chevron-right" size={13} color="#526074" />
  </Pressable>;
  return <View testID="my-page-menu" style={{ gap: 28 }}>
    <Pressable testID="account-profile" accessibilityRole="button" accessibilityLabel="プロフィールを開く" onPress={() => onOpen("profile")} style={{ flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 16 }}>
      <View style={{ width: 54, height: 54, borderRadius: 27, backgroundColor: "#E8EFF8", alignItems: "center", justifyContent: "center" }}><AppIcon name="user" size={24} color="#526074" /></View>
      <View style={{ flex: 1, gap: 5 }}><Text style={{ textAlign: "left", fontSize: 22, fontWeight: "700", color: "#192333" }}>{name}</Text><Text style={{ textAlign: "left", fontSize: 13, color: "#526074" }}>プロフィール{code ? `　${code}` : ""}</Text></View><AppIcon name="chevron-right" size={14} color="#526074" />
    </Pressable>
    <View style={{ gap: 10 }}>
      {onAppSettings && row("地図・振動", "sliders", onAppSettings)}
      {row("ログイン・電話番号", "shield-halved", () => onOpen("security"))}
    </View>
    <View style={{ gap: 10 }}><Text style={{ textAlign: "left", fontSize: 13, color: "#526074" }}>登録情報</Text>
      {row("振込口座", "building-columns", () => onOpen("bank"), bankStatus === "registered" ? "登録済み" : bankStatus === "missing" ? "未登録・初回のお支払いまでに登録" : bankStatus === "error" ? "登録状況を取得できませんでした" : "確認中…", bankStatus === "missing" || bankStatus === "error")}
    </View>
  </View>;
}
