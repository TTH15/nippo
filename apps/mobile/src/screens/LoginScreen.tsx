import { useRef, useState } from "react";
import { View, Text, TextInput, Pressable, ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform, Image } from "react-native";
import { apiFetch } from "@repo/core/api";
import { setAuth, type StoredDriver } from "@repo/core/auth";

import { PASSKEY_LABEL, supportsPasskey, loginWithPasskey, passkeyError } from "../auth/passkey";
import { PasskeySettings } from "../components/PasskeySettings";
import { flushAuthStorage } from "../auth/secureStoreStorage";

// ログインはパスキーとSMS。初めての方は招待リンクからブラウザで登録する。

const INPUT = "bg-white border border-brand-200 rounded-lg py-2.5 px-4 text-lg font-semibold text-center tracking-widest text-brand-900";
const STORAGE_ERROR = "端末にログイン情報を保存できませんでした。もう一度お試しください。";

type LoginResult = { token: string; driver: StoredDriver };

async function saveLogin(result: LoginResult): Promise<void> {
  setAuth(result.token, result.driver);
  await flushAuthStorage();
}

export function LoginScreen({ onLoggedIn }: { onLoggedIn: () => void }) {

  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState("");
  const [saveFailed, setSaveFailed] = useState(false);
  const pendingLogin = useRef<LoginResult | null>(null);
  const [sms, setSms] = useState(!supportsPasskey());
  async function login() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try {
      if (!pendingLogin.current) pendingLogin.current = await loginWithPasskey();
      try {
        await saveLogin(pendingLogin.current);
      } catch {
        setSaveFailed(true);
        setError(STORAGE_ERROR);
        return;
      }
      pendingLogin.current = null;
      onLoggedIn();
    } catch (e) { setError(passkeyError(e)); }
    finally { lock.current = false; setBusy(false); }
  }
  return (
    <KeyboardAvoidingView className="flex-1 bg-brand-50" behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerClassName="grow justify-center p-6" keyboardShouldPersistTaps="handled">
        <View className="bg-white rounded-2xl border border-brand-200 shadow-sm overflow-hidden">
          <View className="items-center py-3 border-b border-brand-100">
            {/* 文字・タグライン入りのプライマリロゴ（原本: apps/web/public/logo/hakotora-logo_primary_logo.svg） */}
            <Image source={require("../../assets/logo-primary.png")} style={{ width: 240, height: 160 }} resizeMode="contain" />
          </View>

          {sms ? <PhoneLogin onLoggedIn={onLoggedIn} onBack={supportsPasskey() ? () => setSms(false) : undefined} /> : <View className="p-5 gap-4">
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => void login()} className="min-h-[48px] py-3 px-3 rounded-lg items-center bg-brand-900">
              {busy ? <ActivityIndicator color="#fff" /> : <Text className="text-white font-medium text-center">{saveFailed ? "保存を再試行" : PASSKEY_LABEL}</Text>}
            </Pressable>
            {error ? <Text accessibilityRole="alert" className="text-red-600 text-sm">{error}</Text> : null}
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => setSms(true)} className="min-h-[44px] justify-center items-center">
              <Text className="text-brand-700 text-sm">SMSでログイン・復旧</Text>
            </Pressable>
          </View>}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// 電話番号 + SMS OTP でログイン（初回ログイン/機種変/復旧の共通経路）。
function PhoneLogin({ onLoggedIn, onBack }: { onLoggedIn: () => void; onBack?: () => void }) {
  const lock = useRef(false);
  const [step, setStep] = useState<"phone" | "otp" | "setup">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const pendingLogin = useRef<LoginResult | null>(null);

  const sendCode = async () => {
    if (lock.current) return;
    lock.current = true;
    setLoading(true);
    setError("");
    pendingLogin.current = null;
    setSaveFailed(false);
    try {
      await apiFetch("/api/otp/send", { method: "POST", body: JSON.stringify({ phone: phone.trim() }) }, { skipAuthRedirect: true });
      setStep("otp");
    } catch (e) {
      setError(e instanceof Error ? e.message : "認証コードの送信に失敗しました");
    } finally {
      lock.current = false; setLoading(false);
    }
  };

  const verify = async () => {
    if (lock.current) return;
    lock.current = true;
    setLoading(true);
    setError("");
    try {
      if (!pendingLogin.current) {
        pendingLogin.current = await apiFetch<LoginResult>(
          "/api/auth/recover/verify",
          { method: "POST", body: JSON.stringify({ phone: phone.trim(), code: code.trim() }) },
          { skipAuthRedirect: true },
        );
      }
      try {
        await saveLogin(pendingLogin.current);
      } catch {
        setSaveFailed(true);
        setError(STORAGE_ERROR);
        return;
      }
      pendingLogin.current = null;
      setStep("setup");
    } catch (e) {
      setError(e instanceof Error ? e.message : "確認に失敗しました");
    } finally {
      lock.current = false; setLoading(false);
    }
  };

  if (step === "setup") return <View className="p-5 gap-4">
    <PasskeySettings />
    <Pressable accessibilityRole="button" onPress={onLoggedIn} className="min-h-[44px] bg-brand-900 rounded-lg items-center py-3"><Text className="text-white">ホームへ</Text></Pressable>
  </View>;

  return (
    <View className="p-5 gap-4">
      {step === "phone" ? (
        <>
          <View className="gap-1.5">
            <Text className="text-[13px] font-medium text-brand-700">電話番号</Text>
            <TextInput
              className="bg-white border border-brand-200 rounded-lg py-2.5 px-4 text-base text-brand-900"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              placeholder="090-1234-5678"
              autoFocus
            />

          </View>
          {error ? <Text accessibilityRole="alert" className="text-red-600 text-[13px] text-center">{error}</Text> : null}
          <Pressable
            className={`py-2.5 rounded-lg items-center active:opacity-80 bg-brand-900 ${!phone.trim() || loading ? "opacity-50" : ""}`}
            onPress={sendCode}
            disabled={!phone.trim() || loading}
          >
            {loading ? <ActivityIndicator color="#fff" /> : <Text className="text-white font-medium text-base">認証コードを送信</Text>}
          </Pressable>
        </>
      ) : (
        <>
          <View className="gap-1.5">
            <Text className="text-[13px] font-medium text-brand-700">{phone} に送った6桁のコード</Text>
            <TextInput
              className={INPUT}
              value={code}
              onChangeText={(t) => { setCode(t.replace(/\D/g, "").slice(0, 6)); pendingLogin.current = null; setSaveFailed(false); }}
              keyboardType="number-pad"
              maxLength={6}
              placeholder="______"
              autoFocus
            />
          </View>
          {error ? <Text accessibilityRole="alert" className="text-red-600 text-[13px] text-center">{error}</Text> : null}
          <Pressable
            className={`py-2.5 rounded-lg items-center active:opacity-80 bg-brand-900 ${code.length !== 6 || loading ? "opacity-50" : ""}`}
            onPress={verify}
            disabled={code.length !== 6 || loading}
          >
            {loading ? <ActivityIndicator color="#fff" /> : <Text className="text-white font-medium text-base">{saveFailed ? "保存を再試行" : "ログイン"}</Text>}
          </Pressable>
          <Pressable onPress={sendCode} disabled={loading} className="min-h-[44px] items-center justify-center">
            <Text className="text-accent-600 text-[13px]">コードを再送する</Text>
          </Pressable>
          <Pressable disabled={loading} onPress={() => { setStep("phone"); setCode(""); setError(""); pendingLogin.current = null; setSaveFailed(false); }} className="min-h-[44px] items-center justify-center"><Text className="text-brand-700 text-sm">番号を入れ直す</Text></Pressable>
        </>
      )}

      {onBack && <Pressable accessibilityRole="button" disabled={loading} onPress={onBack} className="min-h-[44px] items-center justify-center"><Text className="text-brand-700 text-sm">ログイン方法に戻る</Text></Pressable>}
      <Text className="text-[12px] text-brand-600">電話番号も使えない場合は、運営にお問い合わせください。</Text>
      <View className="border-t border-brand-100 pt-3 gap-2 items-center">
        <Text className="text-[12px] text-brand-400 text-center">
          はじめての方は、運営から届いた招待リンクをブラウザで開いて登録してください。
        </Text>
      </View>
    </View>
  );
}
