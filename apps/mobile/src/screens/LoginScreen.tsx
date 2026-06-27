import { useState } from "react";
import { View, Text, TextInput, Pressable, ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform } from "react-native";
import { apiFetch } from "@repo/core/api";
import { setAuth, type StoredDriver } from "@repo/core/auth";

// 会社コード接頭辞（ブランド/テナント確定までは仮で ACE）。
const COMPANY = process.env.EXPO_PUBLIC_COMPANY_CODE ?? "";

export function LoginScreen({ onLoggedIn, onRegister }: { onLoggedIn: () => void; onRegister?: () => void }) {
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
    <KeyboardAvoidingView className="flex-1 bg-slate-100" behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerClassName="grow justify-center p-6 gap-2" keyboardShouldPersistTaps="handled">
        <Text className="text-2xl font-bold text-slate-900 mb-3 text-center">ログイン</Text>

        <Text className="text-[13px] text-slate-700 mt-2">会社コード + ドライバー番号</Text>
        <View className="flex-row items-stretch">
          <View className="justify-center px-3.5 bg-slate-200 rounded-l-lg">
            <Text className="text-base text-slate-600">{COMPANY || "—"}</Text>
          </View>
          <TextInput
            className="flex-1 bg-white border border-slate-300 rounded-lg rounded-l-none py-3 px-4 text-lg text-center"
            value={num}
            onChangeText={(t) => setNum(t.replace(/[^0-9]/g, "").slice(0, 6))}
            keyboardType="number-pad"
            maxLength={6}
            placeholder="123456"
          />
        </View>

        <Text className="text-[13px] text-slate-700 mt-2">PIN</Text>
        <TextInput
          className="bg-white border border-slate-300 rounded-lg py-3 px-4 text-lg text-center"
          value={pin}
          onChangeText={(t) => setPin(t.replace(/[^0-9]/g, "").slice(0, 6))}
          keyboardType="number-pad"
          maxLength={6}
          secureTextEntry
        />

        {error ? <Text className="text-red-600 text-center mt-2">{error}</Text> : null}

        <Pressable
          className={`mt-4 bg-slate-900 py-3.5 rounded-lg items-center active:opacity-80 ${!valid || loading ? "opacity-50" : ""}`}
          onPress={submit}
          disabled={!valid || loading}
        >
          {loading ? <ActivityIndicator color="#fff" /> : <Text className="text-white font-semibold text-base">ログイン</Text>}
        </Pressable>

        {onRegister && (
          <Pressable onPress={onRegister} className="mt-4 items-center">
            <Text className="text-blue-600 text-sm">はじめての方はこちら（参加申請）</Text>
          </Pressable>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
