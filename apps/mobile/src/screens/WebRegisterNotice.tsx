import { View, Text, Pressable, SafeAreaView } from "react-native";
import { useAuth } from "../AuthContext";

// ============================================================
// 本登録（免許・顔写真など）は web 一本化のため、アプリ内では行わず案内のみ。
// 仮承認済みだが本登録が未完のドライバーに表示する（§2-1a）。
// アプリの稼働画面は本承認後に解放されるため、ここでは web での本登録完了を促す。
// ============================================================

export function WebRegisterNotice({ onRefresh }: { onRefresh: () => void }) {
  const { logout } = useAuth();
  return (
    <SafeAreaView className="flex-1 bg-brand-50">
      <View className="flex-1 justify-center p-6 gap-5">
        <View className="bg-white rounded-2xl border border-brand-200 shadow-sm p-6 gap-3">
          <Text className="text-lg font-bold text-brand-900">本登録を完了してください</Text>
          <Text className="text-[14px] leading-6 text-brand-700">
            免許証・顔写真などの本登録は、ブラウザで行います。運営から届いた案内、またはこの端末のブラウザでログインして本登録を完了してください。
          </Text>
          <Text className="text-[13px] leading-5 text-brand-500">
            本登録が運営に確認されると、このアプリで業務を開始できます。
          </Text>
        </View>

        <Pressable
          className="py-3 rounded-lg items-center active:opacity-80 bg-brand-900"
          onPress={onRefresh}
        >
          <Text className="text-white font-medium text-base">状態を再読み込み</Text>
        </Pressable>
        <Pressable className="items-center py-2" onPress={logout}>
          <Text className="text-brand-500 text-[13px]">ログアウト</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
