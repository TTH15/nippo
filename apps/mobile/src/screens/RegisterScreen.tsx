import { useState } from "react";
import { View, Text, TextInput, Pressable, ActivityIndicator, ScrollView } from "react-native";
import { apiFetch } from "@repo/core/api";

// ============================================================
// 仮登録（参加申請）フロー・未認証。
// step1 join_code → 会社名確認 / step2 氏名＋電話 → SMS OTP送信 / step3 コード → 申請 → 承認待ち。
// 重い PII（免許等）は本登録（承認後）。ここは氏名＋電話(OTP)のみ。
// ============================================================

type Step = "code" | "info" | "otp" | "done";

const INPUT = "bg-white border border-slate-300 rounded-lg py-3 px-3.5 text-base";
const BTN = "mt-2 bg-slate-900 py-3.5 rounded-lg items-center active:opacity-80";
const BTN_TEXT = "text-white font-bold text-base";
const LINK = "text-blue-600 text-sm text-center py-2";

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
    <ScrollView contentContainerClassName="grow justify-center p-6 bg-slate-100 gap-4" keyboardShouldPersistTaps="handled">
      <View className="bg-white rounded-xl p-5 gap-2.5 border border-slate-200">
        <Text className="text-xl font-bold text-slate-900 text-center mb-1">参加申請</Text>

        {step === "code" && (
          <>
            <Text className="text-[13px] text-slate-500">運営から受け取った参加コードを入力してください。</Text>
            <TextInput
              className={INPUT}
              value={joinCode}
              onChangeText={(t) => setJoinCode(t.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12))}
              placeholder="参加コード（例 ABC123）"
              autoCapitalize="characters"
              autoFocus
            />
            {error ? <Text className="text-red-600 text-[13px]">{error}</Text> : null}
            <Pressable className={`${BTN} ${!joinCode || loading ? "opacity-40" : ""}`} onPress={lookup} disabled={!joinCode || loading}>
              {loading ? <ActivityIndicator color="#fff" /> : <Text className={BTN_TEXT}>確認</Text>}
            </Pressable>
          </>
        )}

        {step === "info" && (
          <>
            <Text className="text-[15px] text-slate-900 mb-1">
              <Text className="font-bold">{orgName}</Text> に参加を申請します。
            </Text>
            <Text className="text-[13px] text-slate-700 mt-1.5">氏名</Text>
            <TextInput className={INPUT} value={name} onChangeText={setName} placeholder="山田 太郎" autoFocus />
            <Text className="text-[13px] text-slate-700 mt-1.5">電話番号</Text>
            <TextInput className={INPUT} value={phone} onChangeText={setPhone} placeholder="090-1234-5678" keyboardType="phone-pad" />
            <Text className="text-xs text-slate-400">この番号に SMS で認証コードを送ります。アカウント復旧にも使います。</Text>
            {error ? <Text className="text-red-600 text-[13px]">{error}</Text> : null}
            <Pressable
              className={`${BTN} ${!name.trim() || !phone.trim() || loading ? "opacity-40" : ""}`}
              onPress={sendCode}
              disabled={!name.trim() || !phone.trim() || loading}
            >
              {loading ? <ActivityIndicator color="#fff" /> : <Text className={BTN_TEXT}>認証コードを送信</Text>}
            </Pressable>
            <Pressable onPress={() => { setStep("code"); setError(""); }}>
              <Text className={LINK}>‹ コードを入れ直す</Text>
            </Pressable>
          </>
        )}

        {step === "otp" && (
          <>
            <Text className="text-[13px] text-slate-500">{phone} に送った6桁の認証コードを入力してください。</Text>
            <TextInput
              className={`${INPUT} text-center text-2xl tracking-[8px]`}
              value={code}
              onChangeText={(t) => setCode(t.replace(/\D/g, "").slice(0, 6))}
              placeholder="______"
              keyboardType="number-pad"
              maxLength={6}
              autoFocus
            />
            {error ? <Text className="text-red-600 text-[13px]">{error}</Text> : null}
            <Pressable className={`${BTN} ${code.length !== 6 || loading ? "opacity-40" : ""}`} onPress={submit} disabled={code.length !== 6 || loading}>
              {loading ? <ActivityIndicator color="#fff" /> : <Text className={BTN_TEXT}>申請する</Text>}
            </Pressable>
            <Pressable onPress={sendCode} disabled={loading}>
              <Text className={LINK}>コードを再送する</Text>
            </Pressable>
          </>
        )}

        {step === "done" && (
          <View className="items-center gap-2.5 py-2">
            <Text className="text-lg font-bold text-slate-900">申請を受け付けました</Text>
            <Text className="text-sm text-slate-600 text-center leading-6">
              {orgName} の運営による承認をお待ちください。{"\n"}
              承認されると、ドライバーコードと初期PINが連絡されます。
            </Text>
            <Pressable className={`${BTN} self-stretch`} onPress={onBack}>
              <Text className={BTN_TEXT}>ログイン画面へ</Text>
            </Pressable>
          </View>
        )}
      </View>

      {step !== "done" && (
        <Pressable className="items-center" onPress={onBack}>
          <Text className={LINK}>ログイン画面へ戻る</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}
