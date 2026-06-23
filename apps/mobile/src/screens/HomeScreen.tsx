import { View, Text, Pressable, StyleSheet } from "react-native";
import type { StoredDriver } from "@repo/core/auth";

export function HomeScreen({ driver, onLogout }: { driver: StoredDriver; onLogout: () => void }) {
  return (
    <View style={styles.container}>
      <Text style={styles.hello}>こんにちは</Text>
      <Text style={styles.name}>{driver.name}</Text>
      <Text style={styles.meta}>
        {driver.role}
        {driver.driverCode ? ` ・ ${driver.driverCode}` : ""}
      </Text>

      <Pressable style={styles.button} onPress={onLogout}>
        <Text style={styles.buttonText}>ログアウト</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24, gap: 6, backgroundColor: "#f1f5f9" },
  hello: { fontSize: 14, color: "#64748b" },
  name: { fontSize: 28, fontWeight: "700", color: "#0f172a" },
  meta: { fontSize: 13, color: "#64748b", marginBottom: 24 },
  button: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    backgroundColor: "#fff",
  },
  buttonText: { color: "#334155", fontWeight: "600" },
});
