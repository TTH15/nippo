import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { Text, View } from "react-native";
import "./global.css";

// ============================================================
// ハコ虎 Base（現場運営用）。いまは**入れ物だけ**で、業務機能は入っていない。
//
// 何を載せるかは docs/design/hakotora-base-2026-09.md で決める。
// 分担の原則: その場で起きた事実を記録・確認するのが Base、
//             事実から金額や条件を決めるのが Web、
//             自分の業務を進めるのがドライバー用の「ハコ虎」。
//
// 金銭処理（請求・報酬確定・控除・振込・単価や契約条件の変更）はここに持ち込まない。
// ============================================================

export default function App() {
  return (
    <SafeAreaProvider>
      <SafeAreaView className="flex-1 bg-white">
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-lg font-bold text-brand-800">ハコ虎 Base</Text>
          <Text className="mt-2 text-center text-sm text-brand-500">
            現場運営用。機能はまだ入っていません
          </Text>
        </View>
        <StatusBar style="dark" />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
