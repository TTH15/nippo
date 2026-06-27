import { View, Text, Pressable } from "react-native";
import { useAuth } from "../AuthContext";

// 本登録は完了したが、運営の本人確認（本承認）待ち。アプリ本体は開かない。
// NativeWind（className）でのスタイリング。以後の画面はこのパターンで作り込む。
export function KycPending({ onRefresh }: { onRefresh: () => void }) {
  const { logout } = useAuth();
  return (
    <View className="flex-1 items-center justify-center bg-slate-100 px-7 gap-3.5">
      <Text className="text-xl font-bold text-slate-900 text-center">本人確認をお待ちください</Text>
      <Text className="text-sm text-slate-600 text-center leading-6">
        本登録ありがとうございます。{"\n"}
        運営が免許証・顔写真を確認しています。{"\n"}
        承認されるとアプリをご利用いただけます。
      </Text>
      <Pressable className="mt-2 bg-slate-900 py-3.5 px-7 rounded-lg active:opacity-80" onPress={onRefresh}>
        <Text className="text-white font-bold text-[15px]">状態を更新</Text>
      </Pressable>
      <Pressable onPress={logout} className="py-2.5">
        <Text className="text-slate-500">ログアウト</Text>
      </Pressable>
    </View>
  );
}
