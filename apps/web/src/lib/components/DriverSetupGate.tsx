"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCircleCheck, faChevronDown } from "@fortawesome/free-solid-svg-icons";
import { apiFetch, clearAuth } from "@/lib/api";
import { EditorModal } from "@/lib/components/EditorModal";
import { ConfirmDialog } from "@/lib/components/ConfirmDialog";
import { useUnsavedChanges } from "@/lib/recordForms/useUnsavedChanges";
import { SmoothCollapse } from "@/lib/components/SmoothCollapse";
import { formatJPPhoneDisplay } from "@repo/core/logic/profile";
import type { Profile } from "@repo/core/types";

export type SetupBank = { bankName: string; bankNo: string; bankHolder: string };
type SetupState = { profile: Profile; bank: SetupBank };
export const hasSetupBank = (bank: SetupBank) => [bank.bankName, bank.bankNo, bank.bankHolder].every(value => typeof value === "string" && !!value.trim());
const inputClass = "w-full min-h-11 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-slate-400";
const buttonClass = "min-h-11 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50";

// 利用前とマイページで同じ本人用API・入力部品を使う。完了は再取得したサーバー値で判断する。
export function DriverSetupGate({ children }: { children: ReactNode }) {
  return <DriverSetupPanel required>{children}</DriverSetupPanel>;
}

export function DriverSetupPanel({ required = false, children, onDirtyChange }: { required?: boolean; children?: ReactNode; onDirtyChange?: (dirty: boolean) => void }) {
  const id = useId();
  const [state, setState] = useState<SetupState | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [entered, setEntered] = useState(false);
  const [bank, setBank] = useState<SetupBank>({ bankName: "", bankNo: "", bankHolder: "" });
  const [editingBank, setEditingBank] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"bank" | "send" | "verify" | null>(null);
  const [bankError, setBankError] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const [bankSaved, setBankSaved] = useState(false);
  const [logoutConfirming, setLogoutConfirming] = useState(false);
  const dirty = !!state && ["bankName", "bankNo", "bankHolder"].some(key => bank[key as keyof SetupBank].trim() !== state.bank[key as keyof SetupBank].trim());
  useUnsavedChanges(dirty);
  useEffect(() => { onDirtyChange?.(dirty); return () => onDirtyChange?.(false); }, [dirty, onDirtyChange]);

  async function readStatus() {
    const [profile, registration] = await Promise.all([
      apiFetch<Profile>("/api/reports/profile", { cache: "no-store" }),
      apiFetch<SetupBank>("/api/me/registration", { cache: "no-store" }),
    ]);
    if (typeof profile.phoneVerified !== "boolean" || ![registration.bankName, registration.bankNo, registration.bankHolder].every(value => typeof value === "string")) throw new Error("登録状況を確認できませんでした。再読み込みしてください");
    return { profile, bank: registration };
  }
  useEffect(() => {
    let active = true;
    readStatus().then(next => {
      if (!active) return;
      setState(next); setBank(next.bank);
      setEntered(next.profile.phoneVerified && hasSetupBank(next.bank));
    }).catch(() => { if (active) setLoadError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function refresh() {
    try { const next = await readStatus(); setState(next); setLoadError(false); return next; }
    catch { setLoadError(true); throw new Error("登録状況を確認できませんでした。再読み込みしてください"); }
  }
  async function retry() {
    setLoading(true);
    try { const next = await refresh(); if (!state) { setBank(next.bank); setEntered(next.profile.phoneVerified && hasSetupBank(next.bank)); } setBankError(""); setPhoneError(""); }
    catch { /* 復帰操作は取得失敗の表示を残す */ }
    finally { setLoading(false); }
  }
  async function saveBank(event: React.FormEvent) {
    event.preventDefault(); setBankError(""); setBankSaved(false);
    const values = { bankName: bank.bankName.trim(), bankNo: bank.bankNo.trim(), bankHolder: bank.bankHolder.trim() };
    if (!hasSetupBank(values)) { setBankError("振込口座の3項目を入力してください"); return; }
    if (!/^\d{1,8}$/.test(values.bankNo)) { setBankError("口座番号は8桁以内の数字で入力してください"); return; }
    setBusy("bank");
    try {
      await apiFetch("/api/me/registration", { method: "POST", body: JSON.stringify(values) });
      const next = await refresh();
      if (!hasSetupBank(next.bank) || (Object.keys(values) as (keyof SetupBank)[]).some(key => next.bank[key].trim() !== values[key])) throw new Error("振込口座の保存を確認できませんでした。入力を残したまま再度保存してください");
      setBank(next.bank); setEditingBank(false); setBankSaved(true);
    } catch (error) { setBankError(error instanceof Error ? (error.message.startsWith("登録状況を確認できませんでした") ? "" : error.message) : "保存できませんでした。入力を残したまま再度保存してください"); }
    finally { setBusy(null); }
  }
  async function phoneAction(verify: boolean) {
    if (!state?.profile.phone || busy) return;
    setPhoneError(""); setBusy(verify ? "verify" : "send");
    try {
      await apiFetch(`/api/me/phone/${verify ? "verify" : "send"}`, { method: "POST", body: JSON.stringify({ phone: state.profile.phone, ...(verify ? { code } : {}) }) });
      if (verify) {
        const next = await refresh();
        if (!next.profile.phoneVerified) throw new Error("電話番号の確認状況を再読み込みしてください");
        setCode(""); setCodeSent(false);
      } else { setCodeSent(true); setCode(""); }
    } catch (error) { setPhoneError(error instanceof Error ? (error.message.startsWith("登録状況を確認できませんでした") ? "" : error.message) : "確認できませんでした。もう一度お試しください"); }
    finally { setBusy(null); }
  }

  const complete = !!state && state.profile.phoneVerified && hasSetupBank(state.bank) && !loadError;
  const blocked = required && !(entered && complete);
  const body = <>
    {loadError && <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
      <p>登録状況を確認できませんでした。</p><button type="button" onClick={() => void retry()} disabled={loading || !!busy} className="mt-2 min-h-11 font-semibold underline">再読み込み</button>
    </div>}
    {loading && !state && <p role="status" className="py-6 text-sm text-slate-500">登録状況を確認中…</p>}
    {state && <div className="space-y-4">
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="mb-4 flex items-center justify-between gap-3"><h2 className="text-sm font-semibold text-slate-800">電話番号の確認</h2><SetupBadge complete={state.profile.phoneVerified} /></div>
        <p className="break-all text-base font-semibold text-slate-900">{formatJPPhoneDisplay(state.profile.phone) || "電話番号が未登録です"}</p>
        {!state.profile.phoneVerified && (!state.profile.phone ? <p className="mt-3 text-sm text-red-700">運営に電話番号の登録を依頼してください。</p> : <>
          {codeSent ? <form className="mt-4 space-y-3" onSubmit={event => { event.preventDefault(); void phoneAction(true); }}>
            <label className="block space-y-2 text-sm text-slate-600"><span>認証コード</span><input autoFocus aria-label="認証コード" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} className={inputClass} required /></label>
            <p className="text-xs text-slate-500">SMSに届いた6桁の数字</p>
            <button type="submit" disabled={!!busy || code.length !== 6} className={`${buttonClass} w-full`}>{busy === "verify" ? "確認中…" : "確認する"}</button>
            <button type="button" disabled={!!busy} onClick={() => void phoneAction(false)} className="min-h-11 w-full text-sm text-slate-600 underline">{busy === "send" ? "送信中…" : "コードを再送する"}</button>
          </form> : <button type="button" disabled={!!busy} onClick={() => void phoneAction(false)} className={`${buttonClass} mt-4 w-full`}>{busy === "send" ? "送信中…" : "認証コードを送信"}</button>}
        </>)}
        {phoneError && <p role="alert" className="mt-3 text-sm text-red-700">{phoneError}</p>}
      </section>
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between gap-3"><h2 className="text-sm font-semibold text-slate-800">振込口座</h2><SetupBadge complete={hasSetupBank(state.bank)} /></div>
        {hasSetupBank(state.bank) && <div className="mt-4 flex items-start justify-between gap-3">
          <div className="min-w-0 text-sm text-slate-700"><p className="break-words font-medium">{state.bank.bankName}</p><p>末尾 {state.bank.bankNo.slice(-4)}</p><p className="break-words">{state.bank.bankHolder}</p></div>
          <button type="button" id={`${id}-bank-toggle`} aria-expanded={editingBank} aria-controls={`${id}-bank`} disabled={!!busy} onClick={() => setEditingBank(true)} className="flex min-h-11 shrink-0 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm">編集<FontAwesomeIcon icon={faChevronDown} className="w-3" /></button>
        </div>}
        <SmoothCollapse open={!hasSetupBank(state.bank) || editingBank} id={`${id}-bank`}>
          <form onSubmit={saveBank} className="mt-4 space-y-4">
            <label className="block space-y-2 text-sm text-slate-600"><span>銀行名・支店 <span className="text-xs text-red-700">必須</span></span><input aria-label="銀行名・支店" value={bank.bankName} onChange={event => setBank({ ...bank, bankName: event.target.value })} className={inputClass} placeholder="〇〇銀行 〇〇支店" required disabled={!!busy} /></label>
            <label className="block space-y-2 text-sm text-slate-600"><span>口座番号 <span className="text-xs text-red-700">必須</span></span><input aria-label="口座番号" inputMode="numeric" value={bank.bankNo} onChange={event => setBank({ ...bank, bankNo: event.target.value.replace(/[^0-9]/g, "").slice(0, 8) })} className={inputClass} placeholder="1234567" required disabled={!!busy} /></label>
            <label className="block space-y-2 text-sm text-slate-600"><span>口座名義（カナ） <span className="text-xs text-red-700">必須</span></span><input aria-label="口座名義（カナ）" value={bank.bankHolder} onChange={event => setBank({ ...bank, bankHolder: event.target.value })} className={inputClass} placeholder="ミホン タロウ" required disabled={!!busy} /></label>
            <button type="submit" disabled={!!busy} className={`${buttonClass} w-full`}>{busy === "bank" ? "保存中…" : "振込口座を保存"}</button>
            {hasSetupBank(state.bank) && <button type="button" disabled={!!busy} onClick={() => { setBank(state.bank); setEditingBank(false); setBankError(""); }} className="min-h-11 w-full text-sm text-slate-600">変更を取り消す</button>}
          </form>
        </SmoothCollapse>
        {bankError && <p role="alert" className="mt-3 text-sm text-red-700">{bankError}</p>}
        {bankSaved && <p role="status" className="mt-3 text-sm text-green-700">振込口座を保存しました</p>}
      </section>
    </div>}
  </>;
  if (!required) return <section className="mb-8" aria-label="登録情報"><h2 className="mb-3 text-base font-bold text-slate-900">登録情報</h2>{body}</section>;
  return <>
    {/* 背景は入力中に操作できない。解除時に再取得し、登録前の表示を残さない。 */}
    <div key={entered ? "ready" : "setup"} data-driver-setup-background inert={blocked || undefined} aria-hidden={blocked || undefined}>{children}</div>
    {blocked && typeof document !== "undefined" && <EditorModal title="利用開始の準備" dismissible={false} onClose={() => {}} footer={<>
      <button type="button" disabled={!complete || !!busy || loading || dirty} onClick={() => setEntered(true)} className={`${buttonClass} w-full`}>利用を開始する</button>
      <button type="button" disabled={!!busy} onClick={() => setLogoutConfirming(true)} className="mt-2 min-h-11 w-full text-sm text-slate-500">ログアウト</button>
    </>}>
      <p className="mb-4 text-sm text-slate-600">電話番号の確認と振込口座の登録が必要です。</p>
      {body}
      <ConfirmDialog open={logoutConfirming} title="ログアウト" message={dirty ? "入力中の振込口座を破棄してログアウトしますか？" : "ログアウトしますか？"} confirmLabel="ログアウト" cancelLabel="戻る" tone="neutral" onClose={() => setLogoutConfirming(false)} onConfirm={() => { clearAuth(); window.location.href = "/login"; }} />
    </EditorModal>}
  </>;

}

function SetupBadge({ complete }: { complete: boolean }) {
  return <span className={`flex shrink-0 items-center gap-1.5 text-xs font-medium ${complete ? "text-green-700" : "text-amber-800"}`}>
    {complete && <FontAwesomeIcon icon={faCircleCheck} className="w-3.5" />}{complete ? "完了" : "未完了"}
  </span>;
}
