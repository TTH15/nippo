import { View, Text, Pressable } from "react-native";
import { useAuth } from "../AuthContext";

// 本登録は完了したが、運営の本人確認（本承認）待ち。アプリ本体は開かない。
export function KycPending({ onRefresh }: { onRefresh: () => void }) {
  const { logout } = useAuth();
  return (
    <View className="flex-1 items-center justify-center bg-brand-50 px-6">
      <View className="w-full bg-white rounded-2xl border border-brand-200 shadow-sm items-center px-7 py-8 gap-3.5">
        <Text className="text-xl font-bold text-brand-900 text-center">本人確認をお待ちください</Text>
        <Text className="text-sm text-brand-600 text-center leading-6">
          本登録ありがとうございます。{"\n"}
          運営が免許証・顔写真を確認しています。{"\n"}
          承認されるとアプリをご利用いただけます。
        </Text>
        <Pressable className="mt-2 bg-brand-900 py-2.5 px-7 rounded-lg active:opacity-80" onPress={onRefresh}>
          <Text className="text-white font-medium text-[15px]">状態を更新</Text>
        </Pressable>
        <Pressable onPress={logout} className="py-2.5">
          <Text className="text-brand-500">ログアウト</Text>
        </Pressable>
      </View>
    </View>
  );
}
