import { useEffect, useState } from "react";
import {
  View, Text, TextInput, Pressable, ActivityIndicator,
  KeyboardAvoidingView, Platform, StyleSheet,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { apiFetch } from "@repo/core/api";

// ============================================================
// 本登録（KYC）ウィザード。承認後ドライバーが完了するまでアプリ本体を開けない
// ハードゲート。1ステップずつ提出し、上部に進捗バー。
// ステップ: 免許証写真 → 顔写真 → 免許有効期限 → 住所 → 銀行口座。
// ============================================================

type Reg = {
  dob: string; licenseExpiry: string; hasLicensePhoto: boolean; hasFacePhoto: boolean;
  postalCode: string; address: string; bankName: string; bankNo: string; bankHolder: string; complete: boolean;
};

const STEP_KEYS = ["license", "face", "expiry", "address", "bank"] as const;
type StepKey = (typeof STEP_KEYS)[number];

const isStepDone = (k: StepKey, r: Reg): boolean => {
  switch (k) {
    case "license": return r.hasLicensePhoto;
    case "face": return r.hasFacePhoto;
    case "expiry": return !!r.licenseExpiry;
    case "address": return !!r.postalCode && !!r.address;
    case "bank": return !!r.bankName && !!r.bankNo && !!r.bankHolder;
  }
};

export function KycWizard({ onComplete }: { onComplete: () => void }) {
  const [reg, setReg] = useState<Reg | null>(null);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    apiFetch<Reg>("/api/me/registration")
      .then((r) => {
        setReg(r);
        // 最初の未完了ステップから開始（再開対応）
        const first = STEP_KEYS.findIndex((k) => !isStepDone(k, r));
        setStep(first < 0 ? STEP_KEYS.length - 1 : first);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "読み込みに失敗しました"));
  }, []);

  if (!reg) {
    return <View style={styles.center}><ActivityIndicator />{error ? <Text style={styles.error}>{error}</Text> : null}</View>;
  }

  const key = STEP_KEYS[step];
  const set = (k: keyof Reg, v: string) => setReg((r) => (r ? { ...r, [k]: v } : r));

  const pickPhoto = async (kind: "license" | "face", fromCamera: boolean) => {
    setError("");
    try {
      const perm = fromCamera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { setError("写真へのアクセスが許可されていません"); return; }
      const opts = { base64: true, quality: 0.5, mediaTypes: ImagePicker.MediaTypeOptions.Images } as const;
      const res = fromCamera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
      if (res.canceled || !res.assets?.[0]?.base64) return;
      const a = res.assets[0];
      setBusy(true);
      await apiFetch("/api/me/registration/photo", {
        method: "POST",
        body: JSON.stringify({ kind, base64: a.base64, mime: a.mimeType || "image/jpeg" }),
      });
      set(kind === "license" ? "hasLicensePhoto" : "hasFacePhoto", "true" as never);
      setReg((r) => (r ? { ...r, [kind === "license" ? "hasLicensePhoto" : "hasFacePhoto"]: true } : r));
    } catch (e) {
      setError(e instanceof Error ? e.message : "アップロードに失敗しました");
    } finally {
      setBusy(false);
    }
  };

  // 現ステップの入力を保存（部分更新）→ 次へ。最終ステップなら完了確認。
  const next = async () => {
    setError("");
    setBusy(true);
    try {
      if (key === "expiry") {
        await apiFetch("/api/me/registration", { method: "POST", body: JSON.stringify({ licenseExpiry: reg.licenseExpiry, dob: reg.dob }) });
      } else if (key === "address") {
        await apiFetch("/api/me/registration", { method: "POST", body: JSON.stringify({ postalCode: reg.postalCode, address: reg.address }) });
      } else if (key === "bank") {
        await apiFetch("/api/me/registration", { method: "POST", body: JSON.stringify({ bankName: reg.bankName, bankNo: reg.bankNo, bankHolder: reg.bankHolder }) });
      }
      if (step < STEP_KEYS.length - 1) {
        setStep(step + 1);
      } else {
        const fresh = await apiFetch<Reg>("/api/me/registration");
        if (fresh.complete) onComplete();
        else {
          const first = STEP_KEYS.findIndex((k) => !isStepDone(k, fresh));
          setReg(fresh);
          setStep(first < 0 ? 0 : first);
          setError("未完了の項目があります");
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  // 現ステップの「次へ」可否
  const canNext = (() => {
    switch (key) {
      case "license": return reg.hasLicensePhoto;
      case "face": return reg.hasFacePhoto;
      case "expiry": return /^\d{4}-\d{2}-\d{2}$/.test(reg.licenseExpiry);
      case "address": return !!reg.postalCode.trim() && !!reg.address.trim();
      case "bank": return !!reg.bankName.trim() && !!reg.bankNo.trim() && !!reg.bankHolder.trim();
    }
  })();

  const progress = (step + (canNext ? 1 : 0)) / STEP_KEYS.length;

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      {/* 進捗バー */}
      <View style={styles.topBar}>
        <Text style={styles.stepLabel}>本登録　{step + 1} / {STEP_KEYS.length}</Text>
        <View style={styles.track}><View style={[styles.fill, { width: `${Math.round(progress * 100)}%` }]} /></View>
      </View>

      <View style={styles.body}>
        {key === "license" && (
          <PhotoStep title="免許証の写真を登録" done={reg.hasLicensePhoto} busy={busy} onPick={(c) => pickPhoto("license", c)} />
        )}
        {key === "face" && (
          <PhotoStep title="顔写真を登録" done={reg.hasFacePhoto} busy={busy} onPick={(c) => pickPhoto("face", c)} />
        )}
        {key === "expiry" && (
          <View style={styles.fields}>
            <Text style={styles.h}>免許の有効期限</Text>
            <TextInput style={styles.input} value={reg.licenseExpiry} onChangeText={(t) => set("licenseExpiry", t)} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" autoFocus />
            <Text style={styles.hSub}>生年月日（任意）</Text>
            <TextInput style={styles.input} value={reg.dob} onChangeText={(t) => set("dob", t)} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" />
          </View>
        )}
        {key === "address" && (
          <View style={styles.fields}>
            <Text style={styles.h}>住所</Text>
            <TextInput style={styles.input} value={reg.postalCode} onChangeText={(t) => set("postalCode", t)} placeholder="郵便番号" keyboardType="number-pad" autoFocus />
            <TextInput style={styles.input} value={reg.address} onChangeText={(t) => set("address", t)} placeholder="住所" />
          </View>
        )}
        {key === "bank" && (
          <View style={styles.fields}>
            <Text style={styles.h}>銀行口座</Text>
            <TextInput style={styles.input} value={reg.bankName} onChangeText={(t) => set("bankName", t)} placeholder="銀行名・支店" autoFocus />
            <TextInput style={styles.input} value={reg.bankNo} onChangeText={(t) => set("bankNo", t)} placeholder="口座番号" />
            <TextInput style={styles.input} value={reg.bankHolder} onChangeText={(t) => set("bankHolder", t)} placeholder="口座名義（カナ）" />
          </View>
        )}

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>

      <View style={styles.footer}>
        {step > 0 && (
          <Pressable style={styles.backBtn} onPress={() => { setError(""); setStep(step - 1); }} disabled={busy}>
            <Text style={styles.backText}>戻る</Text>
          </Pressable>
        )}
        <Pressable style={[styles.nextBtn, (!canNext || busy) && styles.disabled]} onPress={next} disabled={!canNext || busy}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.nextText}>{step === STEP_KEYS.length - 1 ? "完了" : "次へ"}</Text>}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function PhotoStep({ title, done, busy, onPick }: { title: string; done: boolean; busy: boolean; onPick: (camera: boolean) => void }) {
  return (
    <View style={styles.fields}>
      <Text style={styles.h}>{title}</Text>
      <View style={[styles.photoBox, done && styles.photoBoxDone]}>
        {busy ? <ActivityIndicator /> : <Text style={done ? styles.photoDone : styles.photoHint}>{done ? "✓ 登録済み（撮り直し可）" : "写真を選択してください"}</Text>}
      </View>
      <View style={styles.photoBtns}>
        <Pressable style={styles.smBtn} onPress={() => onPick(false)} disabled={busy}><Text style={styles.smBtnText}>ライブラリ</Text></Pressable>
        <Pressable style={styles.smBtn} onPress={() => onPick(true)} disabled={busy}><Text style={styles.smBtnText}>カメラ</Text></Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: "#f1f5f9" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", gap: 12, backgroundColor: "#f1f5f9" },
  topBar: { paddingTop: 60, paddingHorizontal: 20, paddingBottom: 12, gap: 8, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#e2e8f0" },
  stepLabel: { fontSize: 13, color: "#64748b", fontWeight: "600" },
  track: { height: 6, borderRadius: 3, backgroundColor: "#e2e8f0", overflow: "hidden" },
  fill: { height: 6, borderRadius: 3, backgroundColor: "#0f172a" },
  body: { flex: 1, padding: 20 },
  fields: { gap: 10 },
  h: { fontSize: 20, fontWeight: "700", color: "#0f172a" },
  hSub: { fontSize: 13, color: "#64748b", marginTop: 8 },
  input: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 8, paddingVertical: 12, paddingHorizontal: 14, fontSize: 16 },
  photoBox: { height: 160, borderRadius: 10, borderWidth: 1, borderColor: "#cbd5e1", borderStyle: "dashed", alignItems: "center", justifyContent: "center", backgroundColor: "#fff" },
  photoBoxDone: { borderColor: "#16a34a", borderStyle: "solid", backgroundColor: "#f0fdf4" },
  photoHint: { color: "#94a3b8" },
  photoDone: { color: "#16a34a", fontWeight: "600" },
  photoBtns: { flexDirection: "row", gap: 10 },
  smBtn: { flex: 1, borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 8, paddingVertical: 12, alignItems: "center", backgroundColor: "#fff" },
  smBtnText: { color: "#334155", fontWeight: "600" },
  error: { color: "#dc2626", marginTop: 12 },
  footer: { flexDirection: "row", gap: 12, padding: 20, paddingBottom: 32, backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: "#e2e8f0" },
  backBtn: { paddingVertical: 14, paddingHorizontal: 20, borderRadius: 8, borderWidth: 1, borderColor: "#cbd5e1", alignItems: "center", justifyContent: "center" },
  backText: { color: "#334155", fontWeight: "600" },
  nextBtn: { flex: 1, backgroundColor: "#0f172a", paddingVertical: 14, borderRadius: 8, alignItems: "center" },
  disabled: { opacity: 0.4 },
  nextText: { color: "#fff", fontWeight: "700", fontSize: 16 },
});
