import { useState } from "react";
import { View, Text, TextInput, Pressable, ActivityIndicator, StyleSheet, ScrollView } from "react-native";
import { apiFetch } from "@repo/core/api";

// ============================================================
// 仮登録（参加申請）フロー・未認証。
// step1 join_code → 会社名確認 / step2 氏名＋電話 → SMS OTP送信 / step3 コード → 申請 → 承認待ち。
// 重い PII（免許等）は本登録（承認後）。ここは氏名＋電話(OTP)のみ。
// ============================================================

type Step = "code" | "info" | "otp" | "done";

export function RegisterScreen({ onBack }: { onBack: () => void }) {
  const [step, setStep] = useState<Step>("code");
  const [joinCode, setJoinCode] = useState("");
  const [orgName, setOrgName] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const lookup = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch<{ organizationName: string }>(
        `/api/join/lookup?code=${encodeURIComponent(joinCode.trim().toUpperCase())}`,
      );
      setOrgName(res.organizationName);
      setStep("info");
    } catch (e) {
      setError(e instanceof Error ? e.message : "参加コードが確認できませんでした");
    } finally {
      setLoading(false);
    }
  };

  const sendCode = async () => {
    setLoading(true);
    setError("");
    try {
      await apiFetch("/api/otp/send", { method: "POST", body: JSON.stringify({ phone: phone.trim() }) });
      setStep("otp");
    } catch (e) {
      setError(e instanceof Error ? e.message : "認証コードの送信に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  const submit = async () => {
    setLoading(true);
    setError("");
    try {
      await apiFetch("/api/join", {
        method: "POST",
        body: JSON.stringify({
          joinCode: joinCode.trim().toUpperCase(),
          name: name.trim(),
          phone: phone.trim(),
          code: code.trim(),
        }),
      });
      setStep("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "申請に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <View style={styles.card}>
        <Text style={styles.title}>参加申請</Text>

        {step === "code" && (
          <>
            <Text style={styles.hint}>運営から受け取った参加コードを入力してください。</Text>
            <TextInput
              style={styles.input}
              value={joinCode}
              onChangeText={(t) => setJoinCode(t.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12))}
              placeholder="参加コード（例 ABC123）"
              autoCapitalize="characters"
              autoFocus
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Pressable style={[styles.btn, (!joinCode || loading) && styles.btnDisabled]} onPress={lookup} disabled={!joinCode || loading}>
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>確認</Text>}
            </Pressable>
          </>
        )}

        {step === "info" && (
          <>
            <Text style={styles.confirm}>
              <Text style={styles.org}>{orgName}</Text> に参加を申請します。
            </Text>
            <Text style={styles.label}>氏名</Text>
            <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="山田 太郎" autoFocus />
            <Text style={styles.label}>電話番号</Text>
            <TextInput
              style={styles.input}
              value={phone}
              onChangeText={setPhone}
              placeholder="090-1234-5678"
              keyboardType="phone-pad"
            />
            <Text style={styles.note}>この番号に SMS で認証コードを送ります。アカウント復旧にも使います。</Text>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Pressable
              style={[styles.btn, (!name.trim() || !phone.trim() || loading) && styles.btnDisabled]}
              onPress={sendCode}
              disabled={!name.trim() || !phone.trim() || loading}
            >
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>認証コードを送信</Text>}
            </Pressable>
            <Pressable onPress={() => { setStep("code"); setError(""); }}>
              <Text style={styles.linkText}>‹ コードを入れ直す</Text>
            </Pressable>
          </>
        )}

        {step === "otp" && (
          <>
            <Text style={styles.hint}>{phone} に送った6桁の認証コードを入力してください。</Text>
            <TextInput
              style={[styles.input, styles.otpInput]}
              value={code}
              onChangeText={(t) => setCode(t.replace(/\D/g, "").slice(0, 6))}
              placeholder="______"
              keyboardType="number-pad"
              maxLength={6}
              autoFocus
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Pressable style={[styles.btn, (code.length !== 6 || loading) && styles.btnDisabled]} onPress={submit} disabled={code.length !== 6 || loading}>
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>申請する</Text>}
            </Pressable>
            <Pressable onPress={sendCode} disabled={loading}>
              <Text style={styles.linkText}>コードを再送する</Text>
            </Pressable>
          </>
        )}

        {step === "done" && (
          <View style={styles.doneBox}>
            <Text style={styles.doneTitle}>申請を受け付けました</Text>
            <Text style={styles.doneMsg}>
              {orgName} の運営による承認をお待ちください。{"\n"}
              承認されると、ドライバーコードと初期PINが連絡されます。
            </Text>
            <Pressable style={styles.btn} onPress={onBack}>
              <Text style={styles.btnText}>ログイン画面へ</Text>
            </Pressable>
          </View>
        )}
      </View>

      {step !== "done" && (
        <Pressable style={styles.back} onPress={onBack}>
          <Text style={styles.linkText}>ログイン画面へ戻る</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, justifyContent: "center", padding: 24, backgroundColor: "#f1f5f9", gap: 16 },
  card: { backgroundColor: "#fff", borderRadius: 12, padding: 20, gap: 10, borderWidth: 1, borderColor: "#e2e8f0" },
  title: { fontSize: 20, fontWeight: "700", color: "#0f172a", textAlign: "center", marginBottom: 4 },
  hint: { fontSize: 13, color: "#64748b" },
  confirm: { fontSize: 15, color: "#0f172a", marginBottom: 4 },
  org: { fontWeight: "700" },
  label: { fontSize: 13, color: "#334155", marginTop: 6 },
  note: { fontSize: 12, color: "#94a3b8" },
  input: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 8, paddingVertical: 12, paddingHorizontal: 14, fontSize: 16 },
  otpInput: { textAlign: "center", letterSpacing: 8, fontSize: 22, fontVariant: ["tabular-nums"] },
  error: { color: "#dc2626", fontSize: 13 },
  btn: { marginTop: 8, backgroundColor: "#0f172a", paddingVertical: 14, borderRadius: 8, alignItems: "center" },
  btnDisabled: { opacity: 0.4 },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  linkText: { color: "#2563eb", fontSize: 14, textAlign: "center", paddingVertical: 8 },
  back: { alignItems: "center" },
  doneBox: { alignItems: "center", gap: 10, paddingVertical: 8 },
  doneTitle: { fontSize: 18, fontWeight: "700", color: "#0f172a" },
  doneMsg: { fontSize: 14, color: "#475569", textAlign: "center", lineHeight: 21 },
});
