import { useEffect, useRef, useState } from "react";
import { View, Text, TextInput, Pressable, ActivityIndicator } from "react-native";
import { apiFetch } from "@repo/core/api";
import { PASSKEY_LABEL, supportsPasskey, registerPasskey, reauthenticateWithPasskey, passkeyError } from "../auth/passkey";

type Key = { id: string; name: string | null };
type Status = { keys: Key[]; canRecoverWithSms: boolean };
type Reauth = { recent: boolean; canUseSms: boolean; hasPasskey: boolean };
type Action = { kind: "register" } | { kind: "delete"; key: Key };

export function PasskeySettings() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const grant = useRef<{ token: string; until: number } | null>(null);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState<Action | null>(null);
  const [methods, setMethods] = useState<Reauth | null>(null);
  const [smsSent, setSmsSent] = useState(false);
  const [code, setCode] = useState("");
  const [confirmKey, setConfirmKey] = useState<Key | null>(null);
  const supported = supportsPasskey();

  async function load() { setStatus(await apiFetch<Status>("/api/me/passkeys")); }
  useEffect(() => { let alive = true;
    apiFetch<Status>("/api/me/passkeys").then(s => { if (alive) setStatus(s); }).catch(e => { if (alive) setMessage(passkeyError(e)); });
    return () => { alive = false; };
  }, []);
  async function run(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setMessage("");
    try { await work(); } catch (e) { grant.current = null; setMessage(passkeyError(e)); }
    finally { lock.current = false; setBusy(false); }
  }
  async function perform(action: Action, reauthToken?: string) {
    if (action.kind === "register") await registerPasskey(reauthToken);
    else await apiFetch("/api/me/passkeys", { method: "DELETE", body: JSON.stringify({ id: action.key.id }),
      ...(reauthToken ? { headers: { "x-reauth-token": reauthToken } } : {}),
    }, { skipAuthRedirect: true });
    setPending(null); setMethods(null); setSmsSent(false); setCode(""); setConfirmKey(null);
    await load(); setMessage(action.kind === "register" ? "登録しました" : "削除しました");
  }
  async function begin(action: Action) {
    const state = await apiFetch<Reauth>("/api/auth/reauth");
    if (state.recent) { await perform(action); return; }
    if (grant.current && Date.now() < grant.current.until) { await perform(action, grant.current.token); return; }
    setPending(action); setMethods(state); setSmsSent(false); setCode("");
  }
  async function verified(action: Action, token: string) {
    // OTP成功後のキャンセル/保存失敗でも、使用済みOTP入力画面に閉じ込めない。
    grant.current = { token, until: Date.now() + 240_000 };
    setPending(null); setMethods(null); setSmsSent(false); setCode("");
    await perform(action, token);
  }
  const button = (label: string, action: () => void, disabled = false) => (
    <Pressable accessibilityRole="button" disabled={busy || disabled} onPress={action}
      className={`min-h-[44px] py-3 px-3 rounded-lg border border-brand-200 items-center ${busy || disabled ? "opacity-50" : "active:opacity-80"}`}>
      <Text className="text-brand-900 text-sm text-center">{label}</Text>
    </Pressable>
  );

  return <View className="gap-3">
    <Text className="text-base font-bold text-brand-900">{PASSKEY_LABEL}</Text>
    <View className="bg-white rounded-lg border border-brand-200 p-4 gap-3">
      {status ? <>
        <Text className="text-sm text-brand-600">{status.keys.length ? `${status.keys.length}件登録済み` : "未登録"}</Text>
        {status.keys.map(key => <View key={key.id} className="gap-2 border-b border-brand-100 pb-3">
          <Text className="text-sm text-brand-900">{key.name || "パスキー"}</Text>
          {button("削除", () => setConfirmKey(key), !!pending || (!status.canRecoverWithSms && status.keys.length === 1))}
        </View>)}
        {!status.canRecoverWithSms && <Text className="text-sm text-brand-600">端末を失ったときに備え、電話番号を確認してください。</Text>}
        {supported ? <>
          {button(status.keys.length ? "パスキーを追加" : "設定する", () => void run(() => begin({ kind: "register" })), !!pending || !!confirmKey)}
        </> : <Text className="text-sm text-brand-600">この端末では設定できません。SMSでログインしてください。</Text>}
      </> : !message ? <ActivityIndicator /> : null}
      {confirmKey && !pending && <View className="gap-2">
        <Text className="text-sm text-brand-900">「{confirmKey.name || "パスキー"}」を削除しますか？ このパスキーではログインできなくなります。</Text>
        {button("削除する", () => void run(() => begin({ kind: "delete", key: confirmKey })))}
        {button("戻る", () => setConfirmKey(null))}
      </View>}
      {pending && methods && <View className="gap-3">
        <Text className="text-sm font-bold text-brand-900">本人確認</Text>
        {methods.hasPasskey && supported && button(PASSKEY_LABEL, () => void run(async () => {
          const { reauthToken } = await reauthenticateWithPasskey(); await verified(pending, reauthToken);
        }))}
        {methods.canUseSms && (!smsSent ? button("SMSで確認", () => void run(async () => {
          await apiFetch("/api/auth/reauth/options", { method: "POST", body: JSON.stringify({ method: "sms" }) }); setSmsSent(true);
        })) : <>
          <TextInput accessibilityLabel="認証コード" className="border border-brand-200 rounded-lg p-3 text-center" value={code}
            onChangeText={text => setCode(text.replace(/\D/g, "").slice(0, 6))} keyboardType="number-pad" maxLength={6} placeholder="6桁の認証コード" />
          {button("確認して続ける", () => void run(async () => {
            const { reauthToken } = await apiFetch<{ reauthToken: string }>("/api/auth/reauth/verify", { method: "POST", body: JSON.stringify({ method: "sms", code }) });
            await verified(pending, reauthToken);
          }), code.length !== 6)}
          {button("コードを送り直す", () => { setSmsSent(false); setCode(""); })}
        </>)}
        {!methods.canUseSms && !(methods.hasPasskey && supported) && <Text className="text-sm text-brand-600">電話番号を確認するか、運営にお問い合わせください。</Text>}
        {button("やめる", () => { setPending(null); setMethods(null); setCode(""); setConfirmKey(null); })}
      </View>}
      {busy && <ActivityIndicator />}
      {message ? <Text accessibilityRole="alert" className="text-sm text-brand-700">{message}</Text> : null}
      {button("一覧を読み直す", () => void run(load))}
    </View>
  </View>;
}
