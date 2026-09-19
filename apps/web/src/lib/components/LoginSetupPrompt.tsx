"use client";

import { useId, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCircleCheck, faShieldHalved } from "@fortawesome/free-solid-svg-icons";
import { apiFetch } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { useIsWebAuthnHost } from "@/lib/webauthnHost";
import { registerPasskey } from "@/lib/registerPasskey";
import { useRecentAuthAction } from "./RecentAuth";
import { SmoothCollapse } from "./SmoothCollapse";

type Setup = { phoneVerified: boolean; phoneMasked: string | null; hasPasskey: boolean };
const primary = "min-h-11 w-full rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50";

/** 日報の入力状態から独立。未完了でも業務の保存・提出を止めない。 */
export function LoginSetupPrompt() {
  const { data, error: loadError, refresh } = useApi<Setup>("/api/me/login-setup");
  const supported = useIsWebAuthnHost();
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [verifiedHere, setVerifiedHere] = useState(false);
  const [registeredHere, setRegisteredHere] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const grant = useRef<string | undefined>(undefined);
  const reauth = useRecentAuthAction();
  const panelId = useId();
  const triggerId = useId();
  const disabled = busy || reauth.checking || reauth.verifying;
  const phoneVerified = verifiedHere || data?.phoneVerified;
  const hasPasskey = registeredHere || data?.hasPasskey;
  const complete = phoneVerified && hasPasskey;

  const perform = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError("");
    try { await action(); }
    catch (err) { setError(err instanceof Error ? err.message : "設定を完了できませんでした。もう一度お試しください"); }
    finally { setBusy(false); }
  };

  if (dismissed || (complete && !verifiedHere && !registeredHere)) return null;
  if (complete) return <div role="status" className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-sm text-emerald-800">
    <FontAwesomeIcon icon={faCircleCheck} aria-hidden />
    <span className="flex-1">ログイン設定が完了しました</span>
    <button type="button" onClick={() => setDismissed(true)} className="min-h-11 px-2 underline">閉じる</button>
  </div>;
  if (loadError) return <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
    <p>ログイン設定を読み込めませんでした。</p>
    <button type="button" onClick={() => { void refresh().catch(() => {}); }} className="min-h-11 underline">もう一度読み込む</button>
  </div>;
  if (!data) return null;

  return <section aria-label="ログイン設定" className="rounded-lg border border-amber-200 bg-amber-50 p-3">
    <div className="flex items-center gap-3">
      <FontAwesomeIcon icon={faShieldHalved} aria-hidden className="shrink-0 text-amber-700" />
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-semibold text-slate-900">ログイン方法の登録</h2>
        {!open && <p className="mt-0.5 text-xs text-slate-600">{!phoneVerified && !hasPasskey ? "SMS確認・Passkey登録" : !phoneVerified ? "SMS確認" : "Passkey登録"}が未完了です</p>}
      </div>
      <button type="button" id={triggerId} aria-expanded={open} aria-controls={panelId} disabled={disabled}
        onClick={() => setOpen(!open)} className="min-h-11 shrink-0 rounded-lg border border-amber-300 bg-white px-3 text-sm font-medium text-slate-900 disabled:opacity-50">
        {open ? "閉じる" : "設定する"}
      </button>
    </div>
    <SmoothCollapse open={open} id={panelId} labelledBy={triggerId}>
      <div className="mt-3 space-y-4 border-t border-amber-200 pt-3">
        <div className="space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            {phoneVerified && <FontAwesomeIcon icon={faCircleCheck} aria-hidden className="text-emerald-700" />}
            {phoneVerified ? "SMS確認済み" : "1. 電話番号の確認"}
          </h3>
          {!phoneVerified && (data.phoneMasked ? <>
            <p className="text-sm text-slate-700">登録番号：{data.phoneMasked}</p>
            {sent && <>
              <label className="block text-sm text-slate-700">SMS認証コード
                <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-center text-lg tracking-widest" />
              </label>
              <button type="button" className={primary} disabled={disabled || code.length !== 6} onClick={() => perform(async () => {
                const result = await apiFetch<{ reauthToken: string }>("/api/me/phone/verify", { method: "POST", body: JSON.stringify({ code }) });
                grant.current = result.reauthToken; setVerifiedHere(true); setCode("");
              })}>コードを確認する</button>
            </>}
            <button type="button" disabled={disabled} className={sent ? "min-h-11 w-full text-sm text-slate-600 underline disabled:opacity-50" : primary}
              onClick={() => perform(async () => {
                await apiFetch("/api/me/phone/send", { method: "POST", body: "{}" });
                setSent(true); setCode("");
              })}>{sent ? "コードを再送する" : "SMSコードを送る"}</button>
            <p className="text-xs text-slate-600">この番号を使えない場合は運営にご連絡ください。</p>
          </> : <p className="text-sm text-slate-700">電話番号が登録されていません。運営にご連絡ください。</p>)}
        </div>
        <div className="space-y-3 border-t border-amber-200 pt-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            {hasPasskey && <FontAwesomeIcon icon={faCircleCheck} aria-hidden className="text-emerald-700" />}
            {hasPasskey ? "Passkey登録済み" : "2. Passkeyの登録"}
          </h3>
          {!hasPasskey && <>
            {reauth.verification}
            {supported ? <button type="button" disabled={disabled || !phoneVerified} className={primary}
              onClick={() => { setError(""); void reauth.run(async (token) => {
                try { await registerPasskey(token); setRegisteredHere(true); }
                catch { setError("Passkeyの登録が完了しませんでした。もう一度お試しください。"); }
              }, grant.current); }}>Passkeyを登録する</button>
              : <p className="text-sm text-slate-700">この環境ではPasskeyを登録できません。SafariやChromeでハコ虎を開いてお試しください。</p>}
          </>}
        </div>
        {busy && <p role="status" className="text-sm text-slate-600">確認中...</p>}
        {error && <div role="alert" className="text-sm text-red-700"><p>{error}</p>
          <button type="button" disabled={disabled} className="min-h-11 underline" onClick={() => {
            setError(""); void refresh().catch(() => {});
          }}>設定を読み込み直す</button>
        </div>}
      </div>
    </SmoothCollapse>
  </section>;
}
