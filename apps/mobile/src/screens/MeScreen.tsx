import { useEffect, useState } from "react";
import { View, Text, TextInput, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { AppIcon } from "../components/AppIcon";
import { apiFetch } from "@repo/core/api";
import type { Profile } from "@repo/core/types";
import { buildProfileEntries, digitsOnly, formatJPPhoneDisplay } from "@repo/core/logic/profile";
import { useAuth } from "../AuthContext";
import { PasskeySettings } from "../components/PasskeySettings";
import { MyPageMenu, type AccountSection, type BankStatus } from "../components/MyPageMenu";

// ============================================================
// マイページの入口と、プロフィール/ログイン・電話番号/振込口座の詳細。
// 振込口座は web オンボーディングから除外されたため（§2-1a 2026-07-25）、
// ここが収集の正: 初回の報酬支払いまでに登録してもらう（未登録なら案内を表示）。
// 表示・検証ロジックは Web と同じ @repo/core/logic/profile を再利用。
// 諸報告（書き込み系）は今回スコープ外。
// ============================================================

const INPUT = "bg-white border border-brand-200 rounded-lg min-h-12 py-3 px-4 text-brand-900";

export function MeScreen({ section = "home", onOpen, onAppSettings, onUnsavedChange, active = true }: { section?: AccountSection | "home"; onOpen?: (section: AccountSection) => void; onAppSettings?: () => void; active?: boolean; onUnsavedChange?: (dirty: boolean) => void } = {}) {
  const { driver, logout } = useAuth();
  const [revision, setRevision] = useState(0);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [phoneStep, setPhoneStep] = useState<"input" | "otp">("input");
  const [phoneInput, setPhoneInput] = useState("");
  const [phoneCode, setPhoneCode] = useState("");
  const [phoneSubmitting, setPhoneSubmitting] = useState(false);
  const [phoneMessage, setPhoneMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  const [bankName, setBankName] = useState("");
  const [bankNo, setBankNo] = useState("");
  const [bankHolder, setBankHolder] = useState("");
  const [originalBank, setOriginalBank] = useState("");
  const [bankRegistered, setBankRegistered] = useState(false);
  const [bankStatus, setBankStatus] = useState<BankStatus>("loading");
  const [bankSubmitting, setBankSubmitting] = useState(false);
  const [bankMessage, setBankMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    setBankStatus("loading");
    apiFetch<{ bankName: string; bankNo: string; bankHolder: string }>("/api/me/registration")
      .then((r) => {
        if (!alive) return;
        setOriginalBank(JSON.stringify([(r.bankName || "").trim(), (r.bankNo || "").trim(), (r.bankHolder || "").trim()]));
        setBankName(r.bankName || "");
        setBankNo(r.bankNo || "");
        setBankHolder(r.bankHolder || "");
        setBankRegistered(!!(r.bankName && r.bankNo && r.bankHolder));
        setBankStatus(r.bankName && r.bankNo && r.bankHolder ? "registered" : "missing");
      })
      .catch(() => {
        if (alive) setBankStatus("error");
      });
    return () => {
      alive = false;
    };
  }, [revision, active]);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    setLoading(true); setError("");
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
  }, [revision, active]);

  useEffect(() => {
    onUnsavedChange?.(section === "bank" && !!originalBank && JSON.stringify([bankName.trim(), bankNo.trim(), bankHolder.trim()]) !== originalBank);
  }, [section, originalBank, bankName, bankNo, bankHolder, onUnsavedChange]);
  useEffect(() => () => onUnsavedChange?.(false), [onUnsavedChange]);
  const entries = buildProfileEntries(profile).filter(e => !["銀行名", "口座番号", "口座名義"].includes(e.label));

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
    if (bankStatus === "loading" || bankStatus === "error") return;
    setBankMessage(null);
    setBankSubmitting(true);
    try {
      await apiFetch("/api/me/registration", {
        method: "POST",
        body: JSON.stringify({ bankName: bankName.trim(), bankNo: bankNo.trim(), bankHolder: bankHolder.trim() }),
      });
      setOriginalBank(JSON.stringify([bankName.trim(), bankNo.trim(), bankHolder.trim()]));
      setBankRegistered(true); setBankStatus("registered");
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

  const retry = <Pressable accessibilityRole="button" onPress={() => setRevision(v => v + 1)} style={{ minHeight: 44, justifyContent: "center" }}><Text style={{ color: "#355A84" }}>再読み込み</Text></Pressable>;
  if (section === "home") return <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
    <MyPageMenu name={profile?.name || driver.name} code={profile?.driverCode} bankStatus={bankStatus} onOpen={page => onOpen?.(page)} onAppSettings={onAppSettings} />
    {!!error && <View style={{ marginTop: 20 }}><Text accessibilityRole="alert" style={{ color: "#B91C1C" }}>{error}</Text>{retry}</View>}
  </ScrollView>;

  return (
    <ScrollView testID={`account-detail-${section}`} className="flex-1 bg-brand-50" keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior="automatic" contentContainerClassName="px-4 pt-4 pb-10">
      {section === "profile" && <>

      {loading ? (
        <ActivityIndicator />
      ) : error ? (
        <View><Text accessibilityRole="alert" className="text-red-600 text-sm">{error}</Text>{retry}</View>
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

      </>}
      {section === "bank" && <>
        {bankStatus === "loading" ? <ActivityIndicator /> : bankStatus === "error" ? <View><Text accessibilityRole="alert" className="text-red-600">振込口座を取得できませんでした</Text>{retry}</View> : <>
          <View className="bg-white rounded-lg border border-brand-200 p-4 gap-3">
            {bankRegistered ? (
              <View className="flex-row items-center gap-2">
                <AppIcon name="circle-check" size={14} color="#059669" iconStyle="solid" />
                <Text className="text-sm text-brand-700">登録済み</Text>
              </View>
            ) : (
              <Text className="text-sm text-brand-600">
                報酬の振込先です。初回のお支払いまでにご登録ください。
              </Text>
            )}
            <View className="gap-1">
              <Text className="text-[13px] text-brand-600">銀行名・支店</Text>
              <TextInput accessibilityLabel="銀行名・支店" className={INPUT} value={bankName} onChangeText={setBankName} placeholder="◯◯銀行 ◯◯支店" />
            </View>
            <View className="gap-1">
              <Text className="text-[13px] text-brand-600">口座番号</Text>
              <TextInput
                className={INPUT}
                accessibilityLabel="口座番号"
                value={bankNo}
                onChangeText={(t) => setBankNo(digitsOnly(t).slice(0, 8))}
                keyboardType="number-pad"
                placeholder="1234567"
              />
            </View>
            <View className="gap-1">
              <Text className="text-[13px] text-brand-600">口座名義（カナ）</Text>
              <TextInput accessibilityLabel="口座名義（カナ）" className={INPUT} value={bankHolder} onChangeText={setBankHolder} placeholder="ヤマダ タロウ" />
            </View>
            {bankMessage && (
              <Text className={`text-[13px] ${bankMessage.type === "ok" ? "text-emerald-600" : "text-red-600"}`}>
                {bankMessage.text}
              </Text>
            )}
            <Pressable
              className={`py-2.5 rounded-lg items-center bg-brand-900 active:opacity-80 ${bankSubmitting || !bankName.trim() || !bankNo.trim() || !bankHolder.trim() ? "opacity-50" : ""}`}
              testID="account-save-bank"
              onPress={submitBank}
              disabled={bankSubmitting || !bankName.trim() || !bankNo.trim() || !bankHolder.trim()}
            >
              {bankSubmitting ? <ActivityIndicator color="#fff" /> : <Text className="text-white font-medium">保存する</Text>}
            </Pressable>
          </View>

        </>}
      </>}
      {section === "security" && <>
        {loading ? <ActivityIndicator /> : error ? <View><Text accessibilityRole="alert" className="text-red-600">{error}</Text>{retry}</View> : <>
          <Text className="text-base font-bold text-brand-900 mb-3">電話番号の確認</Text>
          <View className="bg-white rounded-lg border border-brand-200 p-4 gap-3">
            {profile?.phoneVerified ? (
              <View className="flex-row items-center gap-2">
                <AppIcon name="circle-check" size={14} color="#059669" iconStyle="solid" />
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
        </>}

      <View className="mt-8"><PasskeySettings /></View>

      <Pressable
        className="mt-10 self-center border border-brand-200 bg-white py-2.5 px-6 rounded-lg active:opacity-80"
        onPress={logout}
      >
        <Text className="text-brand-700 font-medium">ログアウト</Text>
      </Pressable>
      </>}
    </ScrollView>
  );
}
