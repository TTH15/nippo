"use client";
import { useRef, useState } from "react";
import { startAuthentication } from "@simplewebauthn/browser";
import { apiFetch } from "@/lib/api";
import { useIsWebAuthnHost } from "@/lib/webauthnHost";

import { SmoothCollapse } from "./SmoothCollapse";

type State = { recent: boolean; canUseSms: boolean; phoneMasked: string | null; hasPasskey: boolean };
type Action = (grant?: string) => Promise<void>;
export const reauthHeaders = (grant?: string) => grant ? { "x-reauth-token": grant } : undefined;
const primary = "min-h-11 w-full rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50";

/** 再確認の証明はメモリだけに保持し、サーバーで本人・セッション・期限を毎回検査する。 */
export function useRecentAuthAction() {
  const grant = useRef<string | undefined>(undefined);
  const pending = useRef<Action | null>(null);
  const [state, setState] = useState<State | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const run = async (action: Action, verifiedGrant?: string) => {
    setChecking(true); setError("");
    // SMS初回確認の証明で開始する。再確認で更新した証明を古い入力値で戻さない。
    if (verifiedGrant && !grant.current) grant.current = verifiedGrant;
    try {
      const status = await apiFetch<State>("/api/auth/reauth", { headers: reauthHeaders(grant.current) });
      if (status.recent) await action(grant.current);
      else { pending.current = action; setState(status); }
    } catch (err) { setError(err instanceof Error ? err.message : "本人確認を開始できませんでした"); }
    finally { setChecking(false); }
  };
  const verification = <>
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    <SmoothCollapse open={!!state}>{state && <RecentAuthPanel state={state} onCancel={() => { pending.current = null; setState(null); }}
      onVerified={async (token) => {
        grant.current = token; setState(null);
        const action = pending.current; pending.current = null;
        setChecking(true);
        try { await action?.(token); }
        catch (err) { setError(err instanceof Error ? err.message : "操作を完了できませんでした"); }
        finally { setChecking(false); }
      }} />}</SmoothCollapse>
  </>;
  return { run, verification, checking, verifying: !!state };
}

function RecentAuthPanel({ state, onVerified, onCancel }: {
  state: State; onVerified: (token: string) => Promise<void>; onCancel: () => void;
}) {
  const supported = useIsWebAuthnHost();
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const perform = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError("");
    try { await action(); }
    catch (err) { setError(err instanceof Error && err.name !== "NotAllowedError" ? err.message : "本人確認が完了しませんでした。もう一度お試しください"); }
    finally { setBusy(false); }
  };
  const verify = async (payload: object) => {
    const res = await apiFetch<{ reauthToken: string }>("/api/auth/reauth/verify", { method: "POST", body: JSON.stringify(payload) });
    await onVerified(res.reauthToken);
  };
  return <section aria-label="Passkey変更前の本人確認" className="space-y-3 rounded-lg border border-slate-300 bg-slate-50 p-4">
    <h3 className="text-sm font-semibold text-slate-900">もう一度本人確認</h3>
    {state.hasPasskey && supported && <button type="button" className={primary} disabled={busy} onClick={() => perform(async () => {
      const options = await apiFetch<{ options: Parameters<typeof startAuthentication>[0]["optionsJSON"]; challengeToken: string }>(
        "/api/auth/reauth/options", { method: "POST", body: JSON.stringify({ method: "passkey" }) });
      const response = await startAuthentication({ optionsJSON: options.options });
      await verify({ method: "passkey", response, challengeToken: options.challengeToken });
    })}>登録済みのPasskeyで確認</button>}
    {state.canUseSms && <>
      <p className="text-sm text-slate-600">登録済みの電話番号（{state.phoneMasked}）に送信します。</p>
      <button type="button" className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-50" disabled={busy}
        onClick={() => perform(async () => {
          await apiFetch("/api/auth/reauth/options", { method: "POST", body: JSON.stringify({ method: "sms" }) });
          setSent(true); setCode("");
        })}>{sent ? "コードを再送する" : "SMSで確認する"}</button>
      {sent && <>
        <label className="block text-sm text-slate-700">SMS認証コード
          <input aria-label="本人確認のSMS認証コード" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
            value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 text-center text-lg tracking-widest" />
        </label>
        <button type="button" className={primary} disabled={busy || code.length !== 6}
          onClick={() => perform(() => verify({ method: "sms", code }))}>確認して続ける</button>
      </>}
    </>}
    {!state.canUseSms && (!state.hasPasskey || !supported) && <p className="text-sm text-slate-700">この端末では本人確認を進められません。登録済みの端末を使うか、運営にお問い合わせください。</p>}
    {busy && <p role="status" className="text-sm text-slate-500">確認中...</p>}
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    <button type="button" disabled={busy} onClick={onCancel} className="min-h-11 w-full text-sm text-slate-600 underline">取り消す</button>
  </section>;
}
