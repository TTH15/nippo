import { useState } from "react";
import { View, Text, TextInput, Pressable, ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform, Image } from "react-native";
import { apiFetch } from "@repo/core/api";
import { setAuth, type StoredDriver } from "@repo/core/auth";

// ============================================================
// ログイン画面。確定フロー（§2-1a）に沿って主＝電話番号(SMS OTP)、副＝ドライバーコード+PIN。
// PIN は移行中のフォールバックとして残す（PIN撤廃は全ドライバーの電話認証+Passkey移行後）。
// 参加申請・本登録は web 一本化のため、はじめての方は招待リンク（ブラウザ）へ案内する。
// ドライバーコードは9桁を直接入力する（会社コード接頭辞の分割入力は廃止）。
// ============================================================

type Mode = "phone" | "pin";

const INPUT = "bg-white border border-brand-200 rounded-lg py-2.5 px-4 text-lg font-semibold text-center tracking-widest text-brand-900";

export function LoginScreen({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [mode, setMode] = useState<Mode>("phone");

  return (
    <KeyboardAvoidingView className="flex-1 bg-brand-50" behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerClassName="grow justify-center p-6" keyboardShouldPersistTaps="handled">
        <View className="bg-white rounded-2xl border border-brand-200 shadow-sm overflow-hidden">
          <View className="items-center py-3 border-b border-brand-100">
            {/* 文字・タグライン入りのプライマリロゴ（原本: apps/web/public/logo/hakotora-logo_primary_logo.svg） */}
            <Image source={require("../../assets/logo-primary.png")} style={{ width: 240, height: 160 }} resizeMode="contain" />
          </View>

          {mode === "phone" ? (
            <PhoneLogin onLoggedIn={onLoggedIn} onUsePin={() => setMode("pin")} />
          ) : (
            <PinLogin onLoggedIn={onLoggedIn} onUsePhone={() => setMode("phone")} />
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// 電話番号 + SMS OTP でログイン（初回ログイン/機種変/復旧の共通経路）。
function PhoneLogin({ onLoggedIn, onUsePin }: { onLoggedIn: () => void; onUsePin: () => void }) {
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const sendCode = async () => {
    setLoading(true);
    setError("");
    try {
      await apiFetch("/api/otp/send", { method: "POST", body: JSON.stringify({ phone: phone.trim() }) }, { skipAuthRedirect: true });
      setStep("otp");
    } catch (e) {
      setError(e instanceof Error ? e.message : "認証コードの送信に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  const verify = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch<{ token: string; driver: StoredDriver }>(
        "/api/auth/recover/verify",
        { method: "POST", body: JSON.stringify({ phone: phone.trim(), code: code.trim() }) },
        { skipAuthRedirect: true },
      );
      setAuth(res.token, res.driver);
      onLoggedIn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "確認に失敗しました");
    } finally {
      setLoading(false);
    }
  };

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
            <Text className="text-[12px] text-brand-400">この番号に SMS で認証コードを送ります。</Text>
          </View>
          {error ? <Text className="text-red-600 text-[13px] text-center">{error}</Text> : null}
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
              onChangeText={(t) => setCode(t.replace(/\D/g, "").slice(0, 6))}
              keyboardType="number-pad"
              maxLength={6}
              placeholder="______"
              autoFocus
            />
          </View>
          {error ? <Text className="text-red-600 text-[13px] text-center">{error}</Text> : null}
          <Pressable
            className={`py-2.5 rounded-lg items-center active:opacity-80 bg-brand-900 ${code.length !== 6 || loading ? "opacity-50" : ""}`}
            onPress={verify}
            disabled={code.length !== 6 || loading}
          >
            {loading ? <ActivityIndicator color="#fff" /> : <Text className="text-white font-medium text-base">ログイン</Text>}
          </Pressable>
          <Pressable onPress={sendCode} disabled={loading} className="items-center">
            <Text className="text-accent-600 text-[13px]">コードを再送する</Text>
          </Pressable>
        </>
      )}

      <View className="border-t border-brand-100 pt-3 gap-2 items-center">
        <Pressable onPress={onUsePin}>
          <Text className="text-brand-500 text-[13px]">ドライバーコード・PINでログイン</Text>
        </Pressable>
        <Text className="text-[12px] text-brand-400 text-center">
          はじめての方は、運営から届いた招待リンクをブラウザで開いて登録してください。
        </Text>
      </View>
    </View>
  );
}

// ドライバーコード + PIN（移行中フォールバック）。
function PinLogin({ onLoggedIn, onUsePhone }: { onLoggedIn: () => void; onUsePhone: () => void }) {
  const [code, setCode] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setLoading(true);
    setError("");
    try {
      const driverCode = code.toUpperCase();
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

  const valid = code.length === 9 && pin.length === 6;

  return (
    <View className="p-5 gap-4">
      <View className="gap-1.5">
        <Text className="text-[13px] font-medium text-brand-700">ドライバーコード</Text>
        <TextInput
          className={INPUT}
          value={code}
          onChangeText={(t) => setCode(t.replace(/[^0-9a-zA-Z]/g, "").toUpperCase().slice(0, 9))}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={9}
          placeholder="ACE123456"
          autoFocus
        />
      </View>

      <View className="gap-1.5">
        <Text className="text-[13px] font-medium text-brand-700">PIN</Text>
        <TextInput
          className={INPUT}
          value={pin}
          onChangeText={(t) => setPin(t.replace(/[^0-9]/g, "").slice(0, 6))}
          keyboardType="number-pad"
          maxLength={6}
          secureTextEntry
        />
      </View>

      {error ? <Text className="text-red-600 text-[13px] text-center">{error}</Text> : null}

      <Pressable
        className={`py-2.5 rounded-lg items-center active:opacity-80 bg-brand-900 ${!valid || loading ? "opacity-50" : ""}`}
        onPress={submit}
        disabled={!valid || loading}
      >
        {loading ? <ActivityIndicator color="#fff" /> : <Text className="text-white font-medium text-base">ログイン</Text>}
      </Pressable>

      <View className="border-t border-brand-100 pt-3 items-center">
        <Pressable onPress={onUsePhone}>
          <Text className="text-accent-600 text-[13px] font-medium">電話番号でログイン</Text>
        </Pressable>
      </View>
    </View>
  );
}
