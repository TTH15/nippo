"use client";

import { useId, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCircleCheck, faFingerprint } from "@fortawesome/free-solid-svg-icons";
import { SmoothCollapse } from "./SmoothCollapse";
import { useRecentAuthAction } from "./RecentAuth";

/** 初回登録とSMSログイン後で共用。未完了を登録済みとして扱わない。 */
export function PasskeySetup({ supported, register, onContinue, verifyIdentity = false }: {
  supported: boolean;
  register: (reauthToken?: string) => Promise<void>;
  verifyIdentity?: boolean;
  onContinue: (registered: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState(false);
  const [fallbackOpen, setFallbackOpen] = useState(false);
  const fallbackId = useId();
  const triggerId = useId();
  const reauth = useRecentAuthAction();
  const buttonClass = "min-h-11 w-full rounded-lg bg-slate-900 px-4 py-2.5 font-medium text-white hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed";

  const submit = async (reauthToken?: string) => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await register(reauthToken);
      setDone(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return <div className="space-y-4">
    <div className="space-y-3 py-2 text-center">
      <FontAwesomeIcon icon={faFingerprint} className="h-12 w-12 text-5xl text-slate-700" />
      <h2 className="text-base font-semibold text-slate-900">Passkeyを登録</h2>
      <p className="text-sm text-slate-600">次回から、顔認証や指紋認証など端末の画面ロックでログインできます。</p>
    </div>
    {done ? <>
      <p role="status" className="flex items-center justify-center gap-2 rounded-lg bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
        <FontAwesomeIcon icon={faCircleCheck} className="h-4 w-4" />登録しました
      </p>
      <button type="button" onClick={() => onContinue(true)} className={buttonClass}>次へ</button>
    </> : <>
      {failed && <p role="alert" className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
        登録が完了しませんでした。もう一度お試しください。
      </p>}
      {verifyIdentity && reauth.verification}
      {supported ? <button type="button" disabled={busy || reauth.checking || reauth.verifying}
        onClick={() => verifyIdentity ? reauth.run(submit) : submit()} className={buttonClass}>
        {busy ? "登録中..." : failed ? "もう一度登録する" : "Passkeyを登録する"}
      </button> : <p className="rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600">
        この環境ではPasskeyを登録できません。SafariやChromeでハコ虎を開いてお試しください。
      </p>}
      <button type="button" id={triggerId} aria-expanded={fallbackOpen} aria-controls={fallbackId}
        disabled={busy || reauth.checking || reauth.verifying} onClick={() => setFallbackOpen(!fallbackOpen)}
        className="min-h-11 w-full text-sm text-slate-600 underline underline-offset-4 disabled:opacity-50">
        この端末では設定できない
      </button>
      <SmoothCollapse open={fallbackOpen} id={fallbackId} labelledBy={triggerId}>
        <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm text-slate-600">今はSMSでログインできます。Passkeyは後からマイページで登録してください。</p>
          <button type="button" disabled={busy || reauth.checking || reauth.verifying} onClick={() => onContinue(false)}
            className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 hover:bg-slate-100 disabled:opacity-50">
            SMSでログインする方法で進む
          </button>
        </div>
      </SmoothCollapse>
    </>}
  </div>;
}
