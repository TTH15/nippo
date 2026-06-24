import { useEffect, useState } from "react";
import { View, Text, TextInput, Pressable, ActivityIndicator, Image, KeyboardAvoidingView, Platform } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { apiFetch } from "@repo/core/api";
import { parseLicenseExpiryFromOcr } from "@repo/core/logic/license";
import { recognizeLicenseText } from "../ocr/recognizeLicense";

// ============================================================
// 本登録（KYC）ウィザード。承認後ドライバーが完了するまでアプリ本体を開けない
// ハードゲート。1ステップずつ提出し、上部に進捗バー。NativeWind。
// ステップ: ①免許証写真＋有効期限(OCR) ②顔写真 ③住所 ④銀行口座。
// ============================================================

type Reg = {
  dob: string; licenseExpiry: string; hasLicensePhoto: boolean; hasFacePhoto: boolean;
  postalCode: string; address: string; bankName: string; bankNo: string; bankHolder: string; complete: boolean;
};

const STEP_KEYS = ["license", "face", "address", "bank"] as const;
type StepKey = (typeof STEP_KEYS)[number];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const INPUT = "bg-white border border-slate-300 rounded-lg py-3 px-3.5 text-base";

const isStepDone = (k: StepKey, r: Reg): boolean => {
  switch (k) {
    case "license": return r.hasLicensePhoto && DATE_RE.test(r.licenseExpiry);
    case "face": return r.hasFacePhoto;
    case "address": return !!r.postalCode && !!r.address;
    case "bank": return !!r.bankName && !!r.bankNo && !!r.bankHolder;
  }
};

export function KycWizard({ onComplete }: { onComplete: () => void }) {
  const [reg, setReg] = useState<Reg | null>(null);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [previews, setPreviews] = useState<{ license?: string; face?: string }>({});
  const [ocrNote, setOcrNote] = useState("");

  useEffect(() => {
    apiFetch<Reg>("/api/me/registration")
      .then((r) => {
        setReg(r);
        const first = STEP_KEYS.findIndex((k) => !isStepDone(k, r));
        setStep(first < 0 ? STEP_KEYS.length - 1 : first);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "読み込みに失敗しました"));
  }, []);

  if (!reg) {
    return (
      <View className="flex-1 justify-center items-center gap-3 bg-slate-100">
        <ActivityIndicator />
        {error ? <Text className="text-red-600">{error}</Text> : null}
      </View>
    );
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
      setReg((r) => (r ? { ...r, [kind === "license" ? "hasLicensePhoto" : "hasFacePhoto"]: true } : r));
      setPreviews((p) => ({ ...p, [kind]: a.uri }));

      if (kind === "license") {
        setOcrNote("");
        try {
          const text = await recognizeLicenseText(a.uri);
          const expiry = parseLicenseExpiryFromOcr(text);
          if (expiry) {
            set("licenseExpiry", expiry);
            setOcrNote("OCRで読み取りました。内容をご確認ください。");
          }
        } catch {
          // OCR 失敗は無視（手入力で続行）
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "アップロードに失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const next = async () => {
    setError("");
    setBusy(true);
    try {
      if (key === "license") {
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

  const canNext = (() => {
    switch (key) {
      case "license": return reg.hasLicensePhoto && DATE_RE.test(reg.licenseExpiry);
      case "face": return reg.hasFacePhoto;
      case "address": return !!reg.postalCode.trim() && !!reg.address.trim();
      case "bank": return !!reg.bankName.trim() && !!reg.bankNo.trim() && !!reg.bankHolder.trim();
    }
  })();

  const progress = (step + (canNext ? 1 : 0)) / STEP_KEYS.length;

  return (
    <KeyboardAvoidingView className="flex-1 bg-slate-100" behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View className="pt-[60px] px-5 pb-3 gap-2 bg-white border-b border-slate-200">
        <Text className="text-[13px] text-slate-500 font-semibold">本登録　{step + 1} / {STEP_KEYS.length}</Text>
        <View className="h-1.5 rounded-full bg-slate-200 overflow-hidden">
          <View className="h-1.5 rounded-full bg-slate-900" style={{ width: `${Math.round(progress * 100)}%` }} />
        </View>
      </View>

      <View className="flex-1 p-5">
        {key === "license" && (
          <View className="gap-2.5">
            <PhotoBox title="免許証の写真" done={reg.hasLicensePhoto} previewUri={previews.license} busy={busy} onPick={(c) => pickPhoto("license", c)} />
            <Text className="text-[13px] text-slate-500 mt-2">免許の有効期限</Text>
            <TextInput className={INPUT} value={reg.licenseExpiry} onChangeText={(t) => { set("licenseExpiry", t); setOcrNote(""); }} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" />
            {ocrNote ? <Text className="text-xs text-blue-600">{ocrNote}</Text> : null}
            <Text className="text-[13px] text-slate-500 mt-2">生年月日（任意）</Text>
            <TextInput className={INPUT} value={reg.dob} onChangeText={(t) => set("dob", t)} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" />
          </View>
        )}
        {key === "face" && (
          <View className="gap-2.5">
            <PhotoBox title="顔写真" done={reg.hasFacePhoto} previewUri={previews.face} busy={busy} onPick={(c) => pickPhoto("face", c)} />
          </View>
        )}
        {key === "address" && (
          <View className="gap-2.5">
            <Text className="text-xl font-bold text-slate-900">住所</Text>
            <TextInput className={INPUT} value={reg.postalCode} onChangeText={(t) => set("postalCode", t)} placeholder="郵便番号" keyboardType="number-pad" autoFocus />
            <TextInput className={INPUT} value={reg.address} onChangeText={(t) => set("address", t)} placeholder="住所" />
          </View>
        )}
        {key === "bank" && (
          <View className="gap-2.5">
            <Text className="text-xl font-bold text-slate-900">銀行口座</Text>
            <TextInput className={INPUT} value={reg.bankName} onChangeText={(t) => set("bankName", t)} placeholder="銀行名・支店" autoFocus />
            <TextInput className={INPUT} value={reg.bankNo} onChangeText={(t) => set("bankNo", t)} placeholder="口座番号" />
            <TextInput className={INPUT} value={reg.bankHolder} onChangeText={(t) => set("bankHolder", t)} placeholder="口座名義（カナ）" />
          </View>
        )}

        {error ? <Text className="text-red-600 mt-3">{error}</Text> : null}
      </View>

      <View className="flex-row gap-3 p-5 pb-8 bg-white border-t border-slate-200">
        {step > 0 && (
          <Pressable className="py-3.5 px-5 rounded-lg border border-slate-300 items-center justify-center" onPress={() => { setError(""); setStep(step - 1); }} disabled={busy}>
            <Text className="text-slate-700 font-semibold">戻る</Text>
          </Pressable>
        )}
        <Pressable className={`flex-1 bg-slate-900 py-3.5 rounded-lg items-center active:opacity-80 ${!canNext || busy ? "opacity-40" : ""}`} onPress={next} disabled={!canNext || busy}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text className="text-white font-bold text-base">{step === STEP_KEYS.length - 1 ? "完了" : "次へ"}</Text>}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function PhotoBox({ title, done, previewUri, busy, onPick }: { title: string; done: boolean; previewUri?: string; busy: boolean; onPick: (camera: boolean) => void }) {
  return (
    <View className="gap-2.5">
      <Text className="text-xl font-bold text-slate-900">{title}</Text>
      <View className={`h-[200px] rounded-[10px] border items-center justify-center bg-white overflow-hidden ${done ? "border-green-600 bg-green-50" : "border-slate-300 border-dashed"}`}>
        {previewUri ? (
          <Image source={{ uri: previewUri }} className="w-full h-full" resizeMode="cover" />
        ) : busy ? (
          <ActivityIndicator />
        ) : (
          <Text className={done ? "text-green-600 font-semibold" : "text-slate-400"}>{done ? "✓ 登録済み（撮り直し可）" : "写真を選択してください"}</Text>
        )}
        {previewUri && done ? (
          <View className="absolute top-2 right-2 bg-green-600/90 rounded-md px-2 py-0.5">
            <Text className="text-white text-[11px] font-bold">✓ 登録済み</Text>
          </View>
        ) : null}
      </View>
      <View className="flex-row gap-2.5">
        <Pressable className="flex-1 border border-slate-300 rounded-lg py-3 items-center bg-white active:opacity-80" onPress={() => onPick(false)} disabled={busy}>
          <Text className="text-slate-700 font-semibold">ライブラリ</Text>
        </Pressable>
        <Pressable className="flex-1 border border-slate-300 rounded-lg py-3 items-center bg-white active:opacity-80" onPress={() => onPick(true)} disabled={busy}>
          <Text className="text-slate-700 font-semibold">カメラ</Text>
        </Pressable>
      </View>
    </View>
  );
}
