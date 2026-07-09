import { useState } from "react";
import { View, Text, TextInput, Pressable, ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform, Image } from "react-native";
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
    <KeyboardAvoidingView className="flex-1 bg-brand-50" behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerClassName="grow justify-center p-6" keyboardShouldPersistTaps="handled">
        <View className="bg-white rounded-2xl border border-brand-200 shadow-sm overflow-hidden">
          <View className="items-center py-6 border-b border-brand-100">
            <Image source={require("../../assets/logo-icon.png")} style={{ width: 56, height: 56 }} resizeMode="contain" />
            <Text className="text-lg font-bold text-brand-900 mt-2">ハコ虎</Text>
          </View>

          <View className="p-5 gap-4">
            <View className="gap-1.5">
              <Text className="text-[13px] font-medium text-brand-700">会社コード + ドライバー番号</Text>
              <View className="flex-row items-stretch">
                <View className="justify-center px-4 bg-brand-50 border border-r-0 border-brand-200 rounded-l-lg">
                  <Text className="text-base font-mono text-brand-500">{COMPANY || "—"}</Text>
                </View>
                <TextInput
                  className="flex-1 bg-white border border-brand-200 rounded-lg rounded-l-none py-2.5 px-4 text-lg font-mono text-center tracking-wider text-brand-900"
                  value={num}
                  onChangeText={(t) => setNum(t.replace(/[^0-9]/g, "").slice(0, 6))}
                  keyboardType="number-pad"
                  maxLength={6}
                  placeholder="123456"
                  autoFocus
                />
              </View>
            </View>

            <View className="gap-1.5">
              <Text className="text-[13px] font-medium text-brand-700">PIN</Text>
              <TextInput
                className="bg-white border border-brand-200 rounded-lg py-2.5 px-4 text-lg font-mono text-center tracking-wider text-brand-900"
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

            {onRegister && (
              <Pressable onPress={onRegister} className="items-center pt-1">
                <Text className="text-accent-600 text-[13px] font-medium">はじめての方はこちら（参加申請）</Text>
              </Pressable>
            )}
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
