import { useEffect, useState } from "react";
import { View, Text, TextInput, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { FontAwesome6 } from "@expo/vector-icons";
import { apiFetch } from "@repo/core/api";
import type { Profile } from "@repo/core/types";
import { buildProfileEntries, validatePinChange, digitsOnly, formatJPPhoneDisplay } from "@repo/core/logic/profile";
import { useAuth } from "../AuthContext";
import { Skeleton } from "../components/Skeleton";

// ============================================================
// マイページ（me）＝プロフィール表示＋PIN変更＋電話番号確認＋振込口座。NativeWind。
// 振込口座は web オンボーディングから除外されたため（§2-1a 2026-07-25）、
// ここが収集の正: 初回の報酬支払いまでに登録してもらう（未登録なら案内を表示）。
// 表示・検証ロジックは Web と同じ @repo/core/logic/profile を再利用。
// Passkey登録はネイティブ実装（react-native-passkey ＋ AASA/assetlinks配信）が
// bundleId確定待ちでブロック中のため未着手（[[mobile-app-roadmap]] M8参照）。
// 諸報告（書き込み系）は今回スコープ外。
// ============================================================

const INPUT = "bg-white border border-brand-200 rounded-lg py-2.5 px-4 text-brand-900";

export function MeScreen() {
  const { logout } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [pinSubmitting, setPinSubmitting] = useState(false);
  const [pinMessage, setPinMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  const [phoneStep, setPhoneStep] = useState<"input" | "otp">("input");
  const [phoneInput, setPhoneInput] = useState("");
  const [phoneCode, setPhoneCode] = useState("");
  const [phoneSubmitting, setPhoneSubmitting] = useState(false);
  const [phoneMessage, setPhoneMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  const [bankName, setBankName] = useState("");
  const [bankNo, setBankNo] = useState("");
  const [bankHolder, setBankHolder] = useState("");
  const [bankRegistered, setBankRegistered] = useState(false);
  const [bankSubmitting, setBankSubmitting] = useState(false);
  const [bankMessage, setBankMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    let alive = true;
    apiFetch<{ bankName: string; bankNo: string; bankHolder: string }>("/api/me/registration")
      .then((r) => {
        if (!alive) return;
        setBankName(r.bankName || "");
        setBankNo(r.bankNo || "");
        setBankHolder(r.bankHolder || "");
        setBankRegistered(!!(r.bankName && r.bankNo && r.bankHolder));
      })
      .catch(() => {
        // 取得失敗時は未登録扱いのまま（保存時にエラーが出る）
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    apiFetch<Profile>("/api/reports/profile")
      .then((p) => {
        if (alive) {
          setProfile(p);
          setPhoneInput((prev) => prev || p.phone || "");
        }
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : "プロフィールの取得に失敗しました");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const entries = buildProfileEntries(profile);

  const submitPin = async () => {
    setPinMessage(null);
    const check = validatePinChange(newPin, confirmPin);
    if (!check.ok) {
      setPinMessage({ type: "error", text: check.message! });
      return;
    }
    setPinSubmitting(true);
    try {
      await apiFetch("/api/reports/profile", {
        method: "PATCH",
        body: JSON.stringify({ newPin, confirmPin }),
      });
      setPinMessage({ type: "ok", text: "PINを変更しました" });
      setNewPin("");
      setConfirmPin("");
    } catch (e) {
      setPinMessage({ type: "error", text: e instanceof Error ? e.message : "PINの変更に失敗しました" });
    } finally {
      setPinSubmitting(false);
    }
  };

  const sendPhoneCode = async () => {
    setPhoneMessage(null);
    setPhoneSubmitting(true);
    try {
      await apiFetch("/api/me/phone/send", {
        method: "POST",
        body: JSON.stringify({ phone: phoneInput.trim() }),
      });
      setPhoneStep("otp");
    } catch (e) {
      setPhoneMessage({ type: "error", text: e instanceof Error ? e.message : "認証コードの送信に失敗しました" });
    } finally {
      setPhoneSubmitting(false);
    }
  };

  const submitBank = async () => {
    setBankMessage(null);
    setBankSubmitting(true);
    try {
      await apiFetch("/api/me/registration", {
        method: "POST",
        body: JSON.stringify({ bankName: bankName.trim(), bankNo: bankNo.trim(), bankHolder: bankHolder.trim() }),
      });
      setBankRegistered(true);
      setBankMessage({ type: "ok", text: "振込口座を保存しました" });
    } catch (e) {
      setBankMessage({ type: "error", text: e instanceof Error ? e.message : "保存に失敗しました" });
    } finally {
      setBankSubmitting(false);
    }
  };

  const verifyPhone = async () => {
    setPhoneMessage(null);
    setPhoneSubmitting(true);
    try {
      await apiFetch("/api/me/phone/verify", {
        method: "POST",
        body: JSON.stringify({ phone: phoneInput.trim(), code: phoneCode.trim() }),
      });
      setPhoneMessage({ type: "ok", text: "電話番号を確認しました" });
      setPhoneStep("input");
      setPhoneCode("");
      setProfile((prev) => (prev ? { ...prev, phone: phoneInput.trim(), phoneVerified: true } : prev));
    } catch (e) {
      setPhoneMessage({ type: "error", text: e instanceof Error ? e.message : "確認に失敗しました" });
    } finally {
      setPhoneSubmitting(false);
    }
  };

  return (
    <ScrollView className="flex-1 bg-brand-50" contentContainerClassName="px-4 pt-4 pb-10">

      <Text className="text-base font-bold text-brand-900 mb-3">プロフィール</Text>
      {loading ? (
        <View className="bg-white rounded-lg border border-brand-200 divide-y divide-brand-100">
          {[0, 1, 2, 3, 4].map((i) => (
            <View key={i} className="px-4 py-3 gap-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-4 w-40" />
            </View>
          ))}
        </View>
      ) : error ? (
        <Text className="text-red-600 text-sm">{error}</Text>
      ) : entries.length === 0 ? (
        <Text className="text-brand-500 text-sm">登録内容はありません</Text>
      ) : (
        <View className="bg-white rounded-lg border border-brand-200 divide-y divide-brand-100">
          {entries.map((e) => (
            <View key={e.label} className="px-4 py-3 gap-1">
              <Text className="text-[13px] font-medium text-brand-500">{e.label}</Text>
              <Text className="text-sm text-brand-900">{e.value}</Text>
            </View>
          ))}
        </View>
      )}

      {!loading && !error && (
        <>
          <Text className="text-base font-bold text-brand-900 mb-3 mt-8">振込口座</Text>
          <View className="bg-white rounded-lg border border-brand-200 p-4 gap-3">
            {bankRegistered ? (
              <View className="flex-row items-center gap-2">
                <FontAwesome6 name="circle-check" size={14} color="#059669" iconStyle="solid" />
                <Text className="text-sm text-brand-700">登録済みです（変更するには上書きして保存）</Text>
              </View>
            ) : (
              <Text className="text-sm text-brand-600">
                報酬の振込先です。初回のお支払いまでにご登録ください。
              </Text>
            )}
            <View className="gap-1">
              <Text className="text-[13px] text-brand-600">銀行名・支店</Text>
              <TextInput className={INPUT} value={bankName} onChangeText={setBankName} placeholder="◯◯銀行 ◯◯支店" />
            </View>
            <View className="gap-1">
              <Text className="text-[13px] text-brand-600">口座番号</Text>
              <TextInput
                className={INPUT}
                value={bankNo}
                onChangeText={(t) => setBankNo(digitsOnly(t).slice(0, 8))}
                keyboardType="number-pad"
                placeholder="1234567"
              />
            </View>
            <View className="gap-1">
              <Text className="text-[13px] text-brand-600">口座名義（カナ）</Text>
              <TextInput className={INPUT} value={bankHolder} onChangeText={setBankHolder} placeholder="ヤマダ タロウ" />
            </View>
            {bankMessage && (
              <Text className={`text-[13px] ${bankMessage.type === "ok" ? "text-emerald-600" : "text-red-600"}`}>
                {bankMessage.text}
              </Text>
            )}
            <Pressable
              className={`py-2.5 rounded-lg items-center bg-brand-900 active:opacity-80 ${bankSubmitting || !bankName.trim() || !bankNo.trim() || !bankHolder.trim() ? "opacity-50" : ""}`}
              onPress={submitBank}
              disabled={bankSubmitting || !bankName.trim() || !bankNo.trim() || !bankHolder.trim()}
            >
              {bankSubmitting ? <ActivityIndicator color="#fff" /> : <Text className="text-white font-medium">保存する</Text>}
            </Pressable>
          </View>

          <Text className="text-base font-bold text-brand-900 mb-3 mt-8">PINの変更</Text>
          <View className="bg-white rounded-lg border border-brand-200 p-4 gap-3">
            <View className="gap-1">
              <Text className="text-[13px] text-brand-600">新しいPIN（6桁）</Text>
              <TextInput
                className={`${INPUT} text-center text-lg font-mono tracking-wider`}
                value={newPin}
                onChangeText={(t) => setNewPin(digitsOnly(t).slice(0, 6))}
                keyboardType="number-pad"
                maxLength={6}
                secureTextEntry
                placeholder="000000"
              />
            </View>
            <View className="gap-1">
              <Text className="text-[13px] text-brand-600">確認用（6桁）</Text>
              <TextInput
                className={`${INPUT} text-center text-lg font-mono tracking-wider`}
                value={confirmPin}
                onChangeText={(t) => setConfirmPin(digitsOnly(t).slice(0, 6))}
                keyboardType="number-pad"
                maxLength={6}
                secureTextEntry
                placeholder="000000"
              />
            </View>
            {pinMessage && (
              <Text className={`text-[13px] ${pinMessage.type === "ok" ? "text-emerald-600" : "text-red-600"}`}>
                {pinMessage.text}
              </Text>
            )}
            <Pressable
              className={`py-2.5 rounded-lg items-center bg-brand-900 active:opacity-80 ${pinSubmitting || newPin.length !== 6 || confirmPin.length !== 6 ? "opacity-50" : ""}`}
              onPress={submitPin}
              disabled={pinSubmitting || newPin.length !== 6 || confirmPin.length !== 6}
            >
              {pinSubmitting ? <ActivityIndicator color="#fff" /> : <Text className="text-white font-medium">PINを変更する</Text>}
            </Pressable>
          </View>

          <Text className="text-base font-bold text-brand-900 mb-3 mt-8">電話番号の確認</Text>
          <View className="bg-white rounded-lg border border-brand-200 p-4 gap-3">
            {profile?.phoneVerified ? (
              <View className="flex-row items-center gap-2">
                <FontAwesome6 name="circle-check" size={14} color="#059669" iconStyle="solid" />
                <Text className="text-sm text-brand-700">{formatJPPhoneDisplay(profile.phone)} を確認済みです</Text>
              </View>
            ) : (
              <Text className="text-sm text-brand-600">
                ログインできなくなった時のために、SMSで本人確認できるようにしておきます。
              </Text>
            )}
            {!profile?.phoneVerified && phoneStep === "input" && (
              <>
                <TextInput
                  className={INPUT}
                  value={phoneInput}
                  onChangeText={setPhoneInput}
                  keyboardType="phone-pad"
                  placeholder="090-1234-5678"
                />
                {phoneMessage && (
                  <Text className={`text-[13px] ${phoneMessage.type === "ok" ? "text-emerald-600" : "text-red-600"}`}>
                    {phoneMessage.text}
                  </Text>
                )}
                <Pressable
                  className={`py-2.5 rounded-lg items-center bg-brand-900 active:opacity-80 ${phoneSubmitting || !phoneInput.trim() ? "opacity-50" : ""}`}
                  onPress={sendPhoneCode}
                  disabled={phoneSubmitting || !phoneInput.trim()}
                >
                  {phoneSubmitting ? <ActivityIndicator color="#fff" /> : <Text className="text-white font-medium">認証コードを送信</Text>}
                </Pressable>
              </>
            )}
            {!profile?.phoneVerified && phoneStep === "otp" && (
              <>
                <Text className="text-sm text-brand-600">{phoneInput} に送った6桁の認証コードを入力してください。</Text>
                <TextInput
                  className={`${INPUT} text-center text-2xl font-mono tracking-[8px]`}
                  value={phoneCode}
                  onChangeText={(t) => setPhoneCode(digitsOnly(t).slice(0, 6))}
                  keyboardType="number-pad"
                  maxLength={6}
                  placeholder="______"
                />
                {phoneMessage && (
                  <Text className={`text-[13px] ${phoneMessage.type === "ok" ? "text-emerald-600" : "text-red-600"}`}>
                    {phoneMessage.text}
                  </Text>
                )}
                <Pressable
                  className={`py-2.5 rounded-lg items-center bg-brand-900 active:opacity-80 ${phoneSubmitting || phoneCode.length !== 6 ? "opacity-50" : ""}`}
                  onPress={verifyPhone}
                  disabled={phoneSubmitting || phoneCode.length !== 6}
                >
                  {phoneSubmitting ? <ActivityIndicator color="#fff" /> : <Text className="text-white font-medium">確認する</Text>}
                </Pressable>
                <Pressable
                  onPress={() => {
                    setPhoneStep("input");
                    setPhoneMessage(null);
                  }}
                  className="items-center py-1"
                >
                  <Text className="text-[13px] text-brand-500">‹ 番号を入れ直す</Text>
                </Pressable>
              </>
            )}
          </View>
        </>
      )}

      <Pressable
        className="mt-10 self-center border border-brand-200 bg-white py-2.5 px-6 rounded-lg active:opacity-80"
        onPress={logout}
      >
        <Text className="text-brand-700 font-medium">ログアウト</Text>
      </Pressable>
    </ScrollView>
  );
}
