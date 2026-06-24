import { View, Text, Pressable, StyleSheet } from "react-native";
import { useAuth } from "../AuthContext";

// 本登録は完了したが、運営の本人確認（本承認）待ち。アプリ本体は開かない。
export function KycPending({ onRefresh }: { onRefresh: () => void }) {
  const { logout } = useAuth();
  return (
    <View style={styles.container}>
      <Text style={styles.title}>本人確認をお待ちください</Text>
      <Text style={styles.msg}>
        本登録ありがとうございます。{"\n"}
        運営が免許証・顔写真を確認しています。{"\n"}
        承認されるとアプリをご利用いただけます。
      </Text>
      <Pressable style={styles.btn} onPress={onRefresh}>
        <Text style={styles.btnText}>状態を更新</Text>
      </Pressable>
      <Pressable onPress={logout}>
        <Text style={styles.link}>ログアウト</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", alignItems: "center", padding: 28, gap: 14, backgroundColor: "#f1f5f9" },
  title: { fontSize: 20, fontWeight: "700", color: "#0f172a", textAlign: "center" },
  msg: { fontSize: 14, color: "#475569", textAlign: "center", lineHeight: 22 },
  btn: { marginTop: 8, backgroundColor: "#0f172a", paddingVertical: 13, paddingHorizontal: 28, borderRadius: 8 },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  link: { color: "#64748b", paddingVertical: 10 },
});
