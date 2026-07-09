import type { ReactNode } from "react";
import { Modal, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

// QR認証完了後などに自動表示する下部シート。
// ドラッグでの開閉は行わない一方向フロー（設計: docs/qr_flow.md v2.0）のため、
// gesture-handler 等の追加ネイティブ依存は使わずModal標準のslideアニメーションで実装。
export function BottomSheet({ visible, children }: { visible: boolean; children: ReactNode }) {
  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent>
      <View className="flex-1 justify-end bg-black/40">
        <SafeAreaView edges={["bottom"]} className="bg-white rounded-t-3xl">
          <View className="p-5 gap-3">{children}</View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}
