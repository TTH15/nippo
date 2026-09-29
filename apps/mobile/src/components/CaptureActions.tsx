import { Pressable, Text, View } from "react-native";

/** 撮影確認は常に左が撮り直し、右が次へ。車体・メーター・送信確認で入れ替えない。 */
export function CaptureActions({ onRetake, onConfirm, confirmLabel = "この写真を使う", retakeLabel = "撮り直す", disabled = false, retakeTestID, confirmTestID }: {
  onRetake: () => void; onConfirm: () => void; confirmLabel?: string; retakeLabel?: string;
  disabled?: boolean; retakeTestID?: string; confirmTestID?: string;
}) {
  return <View testID="capture-actions" style={{ flexDirection: "row", alignItems: "stretch", gap: 12 }}>
    <Pressable testID={retakeTestID} accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onRetake} style={{ flex: 1, minWidth: 0, minHeight: 56, paddingHorizontal: 10, paddingVertical: 14, borderRadius: 16, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#68717D", backgroundColor: "#10151DD9", opacity: disabled ? .45 : 1 }}>
      <Text style={{ color: "#E2E6EC", fontSize: 14, textAlign: "center" }}>{retakeLabel}</Text>
    </Pressable>
    <Pressable testID={confirmTestID} accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onConfirm} style={{ flex: 1.5, minWidth: 0, minHeight: 56, paddingHorizontal: 12, paddingVertical: 14, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: "#FFC52C", opacity: disabled ? .45 : 1 }}>
      <Text style={{ color: "#192333", fontSize: 16, fontWeight: "600", textAlign: "center" }}>{confirmLabel}</Text>
    </Pressable>
  </View>;
}
