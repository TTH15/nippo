"use client";

import { useId, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCircleCheck, faFaceSmile, faFingerprint, faGrip, faKeyboard } from "@fortawesome/free-solid-svg-icons";
import { SmoothCollapse } from "./SmoothCollapse";
import { useRecentAuthAction } from "./RecentAuth";

/** 初回登録とSMSログイン後で共用。未完了を登録済みとして扱わない。 */
export function PasskeySetup({ supported, register, onContinue, verifyIdentity = false, required = false, requiredMessage }: {
  supported: boolean;
  register: (reauthToken?: string) => Promise<void>;
  verifyIdentity?: boolean;
  required?: boolean;
  requiredMessage?: string;
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
      <div className="grid grid-cols-4 gap-2" aria-label="端末で使える認証方法">
        {[
          { icon: faFaceSmile, label: "Face ID" },
          { icon: faFingerprint, label: "指紋" },
          { icon: faGrip, label: "パターン" },
          { icon: faKeyboard, label: "PIN" },
        ].map((method) => <div key={method.label} className="flex min-w-0 flex-col items-center gap-1.5">
          <FontAwesomeIcon icon={method.icon} aria-hidden className="h-8 w-8 text-3xl text-slate-700" />
          <span className="text-xs text-slate-500">{method.label}</span>
        </div>)}
      </div>
      <h2 className="text-base font-semibold text-slate-900">かんたんログイン（パスキー）</h2>
      <p className="text-sm text-slate-600">{required
        ? requiredMessage ?? "招待登録を続けるには設定が必要です。"
        : "この端末の画面ロックで、そのままログインできます。"}</p>
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
        {busy ? "設定中..." : failed ? "もう一度設定する" : "設定する"}
      </button> : <p className="rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600">
        この環境では設定できません。SafariやChromeでハコ虎を開いてお試しください。
      </p>}
      {!required && <>
        <button type="button" id={triggerId} aria-expanded={fallbackOpen} aria-controls={fallbackId}
          disabled={busy || reauth.checking || reauth.verifying} onClick={() => setFallbackOpen(!fallbackOpen)}
          className="min-h-11 w-full text-sm text-slate-600 underline underline-offset-4 disabled:opacity-50">
          この端末では設定できない
        </button>
        <SmoothCollapse open={fallbackOpen} id={fallbackId} labelledBy={triggerId}>
          <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm text-slate-600">今はSMSでログインできます。かんたんログインは後からマイページで設定してください。</p>
            <button type="button" disabled={busy || reauth.checking || reauth.verifying} onClick={() => onContinue(false)}
              className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 hover:bg-slate-100 disabled:opacity-50">
              SMSでログインする方法で進む
            </button>
          </div>
        </SmoothCollapse>
      </>}
    </>}
  </div>;
}
