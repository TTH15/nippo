import { useEffect, useState } from "react";
import {
  View, Text, TextInput, Pressable, ScrollView, ActivityIndicator,
  KeyboardAvoidingView, Platform, Alert, StyleSheet,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import * as ImagePicker from "expo-image-picker";
import { apiFetch } from "@repo/core/api";

// ============================================================
// 本登録（KYC）フォーム。承認後ドライバーが免許/顔写真＋住所/銀行＋免許期限を登録。
// 写真は非公開 Storage（/api/me/registration/photo）、テキストは /api/me/registration。
// 免許期限の OCR 自動抽出は次段。
// ============================================================

type Reg = {
  dob: string; licenseExpiry: string; hasLicensePhoto: boolean; hasFacePhoto: boolean;
  postalCode: string; address: string; bankName: string; bankNo: string; bankHolder: string; complete: boolean;
};

export function KycScreen() {
  const nav = useNavigation<{ goBack: () => void }>();
  const [form, setForm] = useState<Reg | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<"" | "license" | "face">("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const set = (k: keyof Reg, v: string) => setForm((f) => (f ? { ...f, [k]: v } : f));

  useEffect(() => {
    apiFetch<Reg>("/api/me/registration")
      .then(setForm)
      .catch(() => setForm({
        dob: "", licenseExpiry: "", hasLicensePhoto: false, hasFacePhoto: false,
        postalCode: "", address: "", bankName: "", bankNo: "", bankHolder: "", complete: false,
      }));
  }, []);

  const pickPhoto = async (kind: "license" | "face", fromCamera: boolean) => {
    setError("");
    try {
      const perm = fromCamera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        setError("写真へのアクセスが許可されていません");
        return;
      }
      const opts = { base64: true, quality: 0.5, mediaTypes: ImagePicker.MediaTypeOptions.Images } as const;
      const res = fromCamera
        ? await ImagePicker.launchCameraAsync(opts)
        : await ImagePicker.launchImageLibraryAsync(opts);
      if (res.canceled || !res.assets?.[0]?.base64) return;
      const a = res.assets[0];
      setUploading(kind);
      await apiFetch("/api/me/registration/photo", {
        method: "POST",
        body: JSON.stringify({ kind, base64: a.base64, mime: a.mimeType || "image/jpeg" }),
      });
      setForm((f) => (f ? { ...f, [kind === "license" ? "hasLicensePhoto" : "hasFacePhoto"]: true } : f));
    } catch (e) {
      setError(e instanceof Error ? e.message : "アップロードに失敗しました");
    } finally {
      setUploading("");
    }
  };

  const photoRow = (kind: "license" | "face", label: string) => {
    const has = kind === "license" ? form?.hasLicensePhoto : form?.hasFacePhoto;
    return (
      <View style={styles.photoRow}>
        <Text style={styles.fieldLabel}>
          {label}
          {has ? <Text style={styles.ok}>　✓ 登録済み</Text> : <Text style={styles.req}>　必須</Text>}
        </Text>
        <View style={styles.photoBtns}>
          {uploading === kind ? (
            <ActivityIndicator />
          ) : (
            <>
              <Pressable style={styles.smBtn} onPress={() => pickPhoto(kind, false)}>
                <Text style={styles.smBtnText}>ライブラリ</Text>
              </Pressable>
              <Pressable style={styles.smBtn} onPress={() => pickPhoto(kind, true)}>
                <Text style={styles.smBtnText}>カメラ</Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
    );
  };

  const save = async () => {
    if (!form) return;
    setSaving(true);
    setError("");
    try {
      await apiFetch("/api/me/registration", {
        method: "POST",
        body: JSON.stringify({
          dob: form.dob, licenseExpiry: form.licenseExpiry, postalCode: form.postalCode,
          address: form.address, bankName: form.bankName, bankNo: form.bankNo, bankHolder: form.bankHolder,
        }),
      });
      if (!form.hasLicensePhoto || !form.hasFacePhoto) {
        Alert.alert("保存しました", "免許証・顔写真の登録も完了してください。");
      } else {
        setDone(true);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  if (!form) {
    return <View style={styles.center}><ActivityIndicator /></View>;
  }

  if (done) {
    return (
      <View style={styles.center}>
        <Text style={styles.doneTitle}>本登録が完了しました</Text>
        <Pressable style={styles.btn} onPress={() => nav.goBack()}>
          <Text style={styles.btnText}>マイページへ</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>本登録</Text>
        <Text style={styles.hint}>免許証・顔写真・住所・銀行口座を登録してください。</Text>

        {photoRow("license", "免許証の写真")}
        {photoRow("face", "顔写真")}

        <Text style={styles.fieldLabel}>免許の有効期限<Text style={styles.req}>　必須</Text></Text>
        <TextInput style={styles.input} value={form.licenseExpiry} onChangeText={(t) => set("licenseExpiry", t)} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" />

        <Text style={styles.fieldLabel}>生年月日<Text style={styles.opt}>　任意</Text></Text>
        <TextInput style={styles.input} value={form.dob} onChangeText={(t) => set("dob", t)} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" />

        <Text style={styles.section}>住所</Text>
        <TextInput style={styles.input} value={form.postalCode} onChangeText={(t) => set("postalCode", t)} placeholder="郵便番号" keyboardType="number-pad" />
        <TextInput style={styles.input} value={form.address} onChangeText={(t) => set("address", t)} placeholder="住所" />

        <Text style={styles.section}>銀行口座</Text>
        <TextInput style={styles.input} value={form.bankName} onChangeText={(t) => set("bankName", t)} placeholder="銀行名・支店" />
        <TextInput style={styles.input} value={form.bankNo} onChangeText={(t) => set("bankNo", t)} placeholder="口座番号" />
        <TextInput style={styles.input} value={form.bankHolder} onChangeText={(t) => set("bankHolder", t)} placeholder="口座名義（カナ）" />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable style={[styles.btn, saving && styles.btnDisabled]} onPress={save} disabled={saving}>
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>登録する</Text>}
        </Pressable>
        <Pressable onPress={() => nav.goBack()}>
          <Text style={styles.link}>マイページへ戻る</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: "#f1f5f9" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", gap: 12, backgroundColor: "#f1f5f9", padding: 24 },
  content: { padding: 20, paddingTop: 56, gap: 8 },
  title: { fontSize: 24, fontWeight: "700", color: "#0f172a" },
  hint: { fontSize: 13, color: "#64748b", marginBottom: 8 },
  section: { fontSize: 14, fontWeight: "600", color: "#334155", marginTop: 12 },
  fieldLabel: { fontSize: 13, color: "#334155", marginTop: 8 },
  req: { fontSize: 12, color: "#dc2626" },
  opt: { fontSize: 12, color: "#94a3b8" },
  ok: { fontSize: 12, color: "#16a34a", fontWeight: "600" },
  input: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 8, paddingVertical: 11, paddingHorizontal: 12, fontSize: 16 },
  photoRow: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 8, padding: 12, gap: 8, marginTop: 4 },
  photoBtns: { flexDirection: "row", gap: 10 },
  smBtn: { borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 8, paddingVertical: 8, paddingHorizontal: 16, backgroundColor: "#fff" },
  smBtnText: { color: "#334155", fontWeight: "600", fontSize: 13 },
  error: { color: "#dc2626", marginTop: 8 },
  btn: { marginTop: 16, backgroundColor: "#0f172a", paddingVertical: 14, borderRadius: 8, alignItems: "center" },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  link: { color: "#2563eb", textAlign: "center", paddingVertical: 12 },
  doneTitle: { fontSize: 18, fontWeight: "700", color: "#0f172a" },
});
