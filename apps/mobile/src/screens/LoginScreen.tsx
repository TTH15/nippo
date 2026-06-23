import { useState } from "react";
import { View, Text, TextInput, Pressable, ActivityIndicator, StyleSheet } from "react-native";
import { apiFetch } from "@repo/core/api";
import { setAuth, type StoredDriver } from "@repo/core/auth";

// 会社コード接頭辞（ブランド/テナント確定までは仮で ACE）。
const COMPANY = process.env.EXPO_PUBLIC_COMPANY_CODE ?? "";

export function LoginScreen({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [num, setNum] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setLoading(true);
    setError("");
    try {
      const driverCode = `${COMPANY}${num}`.toUpperCase();
      const res = await apiFetch<{ token: string; driver: StoredDriver }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ loginType: "driver", driverCode, pin }),
      });
      setAuth(res.token, res.driver);
      onLoggedIn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "ログインに失敗しました");
    } finally {
      setLoading(false);
    }
  };

  const valid = num.length === 6 && pin.length === 6;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>ログイン</Text>

      <Text style={styles.label}>会社コード + ドライバー番号</Text>
      <View style={styles.row}>
        <View style={styles.prefix}>
          <Text style={styles.prefixText}>{COMPANY || "—"}</Text>
        </View>
        <TextInput
          style={[styles.input, styles.inputGrow]}
          value={num}
          onChangeText={(t) => setNum(t.replace(/[^0-9]/g, "").slice(0, 6))}
          keyboardType="number-pad"
          maxLength={6}
          placeholder="123456"
          autoFocus
        />
      </View>

      <Text style={styles.label}>PIN</Text>
      <TextInput
        style={styles.input}
        value={pin}
        onChangeText={(t) => setPin(t.replace(/[^0-9]/g, "").slice(0, 6))}
        keyboardType="number-pad"
        maxLength={6}
        secureTextEntry
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable
        style={[styles.button, (!valid || loading) && styles.buttonDisabled]}
        onPress={submit}
        disabled={!valid || loading}
      >
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>ログイン</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", padding: 24, gap: 8, backgroundColor: "#f1f5f9" },
  title: { fontSize: 22, fontWeight: "700", color: "#0f172a", marginBottom: 12, textAlign: "center" },
  label: { fontSize: 13, color: "#334155", marginTop: 8 },
  row: { flexDirection: "row", alignItems: "stretch" },
  prefix: {
    justifyContent: "center",
    paddingHorizontal: 14,
    backgroundColor: "#e2e8f0",
    borderTopLeftRadius: 8,
    borderBottomLeftRadius: 8,
  },
  prefixText: { fontSize: 16, color: "#475569", fontVariant: ["tabular-nums"] },
  input: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    fontSize: 18,
    textAlign: "center",
  },
  inputGrow: { flex: 1, borderTopLeftRadius: 0, borderBottomLeftRadius: 0 },
  error: { color: "#dc2626", textAlign: "center", marginTop: 8 },
  button: {
    marginTop: 16,
    backgroundColor: "#0f172a",
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: "#fff", fontWeight: "600", fontSize: 16 },
});
