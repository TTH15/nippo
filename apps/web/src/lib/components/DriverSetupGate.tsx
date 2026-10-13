"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { startAuthentication } from "@simplewebauthn/browser";
import { motion, useReducedMotion } from "motion/react";
import { SmoothCollapse } from "@/lib/components/SmoothCollapse";
import { OtpCodeInput } from "@/lib/components/OtpCodeInput";
import { disclosureTransition, instantTransition, setupConfirmationDelayMs } from "@/lib/ui/motion";
import { useSmsResendCooldown } from "@/lib/hooks/useSmsResendCooldown";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCircleCheck, faLock } from "@fortawesome/free-solid-svg-icons";
import { apiFetch } from "@/lib/api";
import { CustomSelect } from "@/lib/components/CustomSelect";
import { EditorModal } from "@/lib/components/EditorModal";
import { ConfirmDialog } from "@/lib/components/ConfirmDialog";
import { useUnsavedChanges } from "@/lib/recordForms/useUnsavedChanges";
import { useIsWebAuthnHost } from "@/lib/webauthnHost";
import { normalizeBankAccount, requiresBankChangePasskey, bankFields, legacyBankFields, bankAccountTypeLabels, bankAccountTypes, type BankAccountType, type BankAccount } from "@/lib/bankAccount";
import { formatJPPhoneDisplay } from "@repo/core/logic/profile";
import type { Profile } from "@repo/core/types";

export type SetupBank = BankAccount;
type SetupState = { profile: Profile; bank: SetupBank; hasPasskey: boolean };
type Step = "phone" | "bank";
export const hasSetupBank = (bank: SetupBank) => legacyBankFields.every(key => !!bank[key]?.trim());
const inputClass = "block h-14 w-full appearance-none rounded-none border-0 border-b-2 border-slate-300 bg-transparent px-0 py-2 text-2xl leading-8 text-slate-900 shadow-none outline-none placeholder:text-slate-400 focus:border-slate-900 focus:outline-none focus:ring-0 disabled:text-slate-500";
const buttonClass = "min-h-11 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50";

export function DriverSetupGate({ children }: { children: ReactNode }) {
  return <DriverSetupPanel required>{children}</DriverSetupPanel>;
}

export function DriverSetupPanel({ required = false, children, onDirtyChange }: { required?: boolean; children?: ReactNode; onDirtyChange?: (dirty: boolean) => void }) {
  const id = useId();
  const reduceMotion = useReducedMotion();
  const resendCooldown = useSmsResendCooldown();
  const supported = useIsWebAuthnHost();
  const [state, setState] = useState<SetupState | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [entered, setEntered] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  const [stepIndex, setStepIndex] = useState(0);
  const [bank, setBank] = useState<SetupBank>({ bankName: "", bankNo: "", bankHolder: "" });
  const [editingBank, setEditingBank] = useState(false);
  const [bankReview, setBankReview] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [phone, setPhone] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
  const [phoneSuccess, setPhoneSuccess] = useState(false);
  const [busy, setBusy] = useState<"bank" | "send" | "verify" | null>(null);
  const [bankError, setBankError] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const [bankSaved, setBankSaved] = useState("");
  const dirty = !!state && bankFields.some(key => (bank[key] ?? "").trim() !== (state.bank[key] ?? "").trim());
  const changingBank = !!state && hasSetupBank(state.bank);
  useUnsavedChanges(dirty);
  useEffect(() => { onDirtyChange?.(dirty); return () => onDirtyChange?.(false); }, [dirty, onDirtyChange]);

  useEffect(() => {
    if (!phoneSuccess) return;
    const timer = window.setTimeout(() => {
      setCode(""); setCodeSent(false); setPhoneSuccess(false);
      if (required) {
        if (steps[stepIndex + 1]) setStepIndex(stepIndex + 1);
        else if (state?.profile.phoneVerified && hasSetupBank(state.bank)) setEntered(true);
      }
    }, setupConfirmationDelayMs);
    return () => window.clearTimeout(timer);
  }, [phoneSuccess, required, steps, stepIndex, state]);

  async function readStatus() {
    const [profile, registration] = await Promise.all([
      apiFetch<Profile>("/api/reports/profile", { cache: "no-store" }),
      apiFetch<SetupBank & { hasPasskey?: boolean }>("/api/me/registration", { cache: "no-store" }),
    ]);
    if (typeof profile.phoneVerified !== "boolean" || !legacyBankFields.every(key => typeof registration[key] === "string")) throw new Error("登録状況を確認できませんでした。再読み込みしてください");
    return { profile, bank: { bankName: registration.bankName, bankNo: registration.bankNo, bankHolder: registration.bankHolder, bankBranch: registration.bankBranch ?? "", bankType: registration.bankType ?? "" }, hasPasskey: registration.hasPasskey === true };
  }
  function initialize(next: SetupState) {
    setState(next); setBank(next.bank); setPhone(next.profile.phone || "");
    setSteps([...(next.profile.phoneVerified ? [] : ["phone" as const]), ...(hasSetupBank(next.bank) ? [] : ["bank" as const])]);
    setEntered(next.profile.phoneVerified && hasSetupBank(next.bank));
  }
  useEffect(() => {
    let active = true;
    readStatus().then(next => { if (active) initialize(next); })
      .catch(() => { if (active) setLoadError(true); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  async function refresh() {
    try { const next = await readStatus(); setState(next); setLoadError(false); return next; }
    catch { setLoadError(true); throw new Error("登録状況を確認できませんでした。再読み込みしてください"); }
  }
  async function retry() {
    setLoading(true);
    try { const next = await refresh(); if (!state) initialize(next); setBankError(""); setPhoneError(""); }
    catch { /* 入力と再試行の入口を残す */ }
    finally { setLoading(false); }
  }
  async function saveBank(event?: React.FormEvent) {
    event?.preventDefault(); if (busy) return;
    setBankError(""); setBankSaved("");
    const values = normalizeBankAccount(bank);
    if (!values || !values.bankBranch || !values.bankType) { setBankError("銀行名、支店名、口座種別、口座番号、名義を入力してください"); return; }
    const requiresPasskey = !!state && requiresBankChangePasskey(state.bank, values);
    if (requiresPasskey && !bankReview) { setEditingBank(true); setBankReview(true); return; }
    setBusy("bank");
    try {
      let bankChangeToken: string | undefined;
      if (requiresPasskey) {
        // 毎回新しくパスキーを検証し、この変更だけの短命・一回限りの確認情報を使う。
        const intent = { method: "passkey", action: "bank_change", bank: values, previousBank: state?.bank };
        const options = await apiFetch<{ options: Parameters<typeof startAuthentication>[0]["optionsJSON"]; challengeToken: string }>("/api/auth/reauth/options", { method: "POST", body: JSON.stringify(intent) });
        const response = await startAuthentication({ optionsJSON: options.options });
        const verified = await apiFetch<{ bankChangeToken: string }>("/api/auth/reauth/verify", { method: "POST", body: JSON.stringify({ ...intent, challengeToken: options.challengeToken, response }) });
        if (!verified.bankChangeToken) throw new Error("パスキーの確認を完了できませんでした。もう一度お試しください");
        bankChangeToken = verified.bankChangeToken;
      }
      await apiFetch("/api/me/registration", { method: "POST", headers: bankChangeToken ? { "x-bank-change-token": bankChangeToken } : undefined, body: JSON.stringify(values) });
      const next = await refresh();
      if (!hasSetupBank(next.bank) || bankFields.some(key => (next.bank[key] ?? "").trim() !== (values[key] ?? ""))) throw new Error("振込口座の保存を確認できませんでした。入力を残したまま再度保存してください");
      setBank(next.bank); setEditingBank(false); setBankReview(false); setBankSaved(requiresPasskey ? "振込口座を変更しました" : "振込口座を登録しました");
      if (required && !editingBank && next.profile.phoneVerified) setEntered(true);
    } catch (error) {
      setBankError(error instanceof Error && error.name === "NotAllowedError" ? "パスキーの確認を中止しました。変更内容は残っています。" : error instanceof Error ? (error.message.startsWith("登録状況を確認できませんでした") ? "" : error.message) : "変更できませんでした。もう一度お試しください");
    } finally { setBusy(null); }
  }
  async function phoneAction(verify: boolean) {
    if (!phone.trim() || busy || phoneSuccess || (!verify && resendCooldown.seconds > 0)) return;
    setPhoneError(""); setBusy(verify ? "verify" : "send");
    try {
      await apiFetch(`/api/me/phone/${verify ? "verify" : "send"}`, { method: "POST", body: JSON.stringify({ phone: phone.trim(), ...(verify ? { code } : {}) }) });
      if (verify) {
        const next = await refresh();
        if (!next.profile.phoneVerified) throw new Error("電話番号の確認状況を再読み込みしてください");
        setPhoneSuccess(true);
      } else { resendCooldown.start(); setCodeSent(true); setCode(""); }
    } catch (error) { setPhoneError(error instanceof Error ? (error.message.startsWith("登録状況を確認できませんでした") ? "" : error.message) : "確認できませんでした。もう一度お試しください"); }
    finally { setBusy(null); }
  }
  async function openBankChange() {
    setBankError(""); setBankSaved(""); setLoading(true);
    try { const next = await refresh(); setBank(next.bank); setBankReview(false); setEditingBank(true); }
    catch { /* 取得失敗なら編集を開かない */ }
    finally { setLoading(false); }
  }
  const cancelBank = () => {
    if (busy) return;
    if (dirty) setDiscarding(true);
    else { setEditingBank(false); setBankReview(false); setBankError(""); }
  };
  const bankInputClass = "block h-12 w-full appearance-none rounded-none border-0 border-b-2 border-slate-300 bg-transparent px-0 py-2 text-base leading-6 text-slate-900 outline-none placeholder:text-slate-400 focus:border-slate-900 focus:ring-0";
  const bankInput = (key: "bankName" | "bankBranch" | "bankNo" | "bankHolder", label: string, placeholder: string) => <label className="block space-y-1 text-xs text-slate-600">
    <span>{label} <span className="text-red-700">必須</span></span>
    <input autoFocus={required && key === "bankName"} aria-label={label} inputMode={key === "bankNo" ? "numeric" : undefined} value={bank[key] ?? ""}
      onChange={event => setBank({ ...bank, [key]: key === "bankNo" ? event.target.value.replace(/[^0-9]/g, "").slice(0, 8) : event.target.value })}
      className={bankInputClass} placeholder={placeholder} required disabled={!!busy} />
  </label>;
  const bankForm = <form id={`${id}-bank-form`} onSubmit={saveBank} className="space-y-2">
    <div className="grid grid-cols-2 gap-3">{bankInput("bankName", "銀行名", "〇〇銀行")}{bankInput("bankBranch", "支店名", "〇〇支店")}</div>
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3">
      <div className="space-y-1"><label htmlFor={`${id}-bank-type`} className="block text-xs text-slate-600">口座種別 <span className="text-red-700">必須</span></label>
        <CustomSelect id={`${id}-bank-type`} ariaLabel="口座種別" size="md" variant="underline" value={bank.bankType ?? ""} options={bankAccountTypes.map(value => ({ value, label: bankAccountTypeLabels[value] }))} placeholder="選択" clearable={false} disabled={!!busy} onChange={value => setBank({ ...bank, bankType: value as BankAccountType })} />
      </div>{bankInput("bankNo", "口座番号", "1234567")}
    </div>
    {bankInput("bankHolder", "口座名義（カナ）", "ミホン タロウ")}
    {!required && !editingBank && <button type="submit" disabled={!!busy} className={`${buttonClass} w-full`}>{busy === "bank" ? "保存中…" : "振込口座を登録"}</button>}
  </form>;
  const setupSectionClass = required ? "w-full py-1" : "rounded-lg border border-slate-200 bg-white p-4";
  const phoneSection = state && <section className={setupSectionClass}>
    {!required && <div className="mb-4 flex items-center justify-between gap-3"><h2 className="text-sm font-semibold text-slate-800">{codeSent || phoneSuccess ? "SMS認証コードを入力" : "電話番号の確認"}</h2><SetupBadge complete={state.profile.phoneVerified} /></div>}
    {state.profile.phoneVerified && !phoneSuccess ? <p className="text-base font-semibold text-slate-900">{formatJPPhoneDisplay(state.profile.phone || phone)}</p> : <>
      {!codeSent && !phoneSuccess ? <label className="block space-y-2 text-sm text-slate-600"><span>電話番号 <span className="text-xs text-red-700">必須</span></span><input aria-label="電話番号" type="tel" autoComplete="tel" inputMode="tel" value={phone} disabled={!!busy} onChange={event => setPhone(event.target.value)} className={inputClass} placeholder="09012345678" /></label>
        : <motion.div layout transition={reduceMotion ? instantTransition : disclosureTransition} className="mb-5 flex min-h-14 items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2">
          <div className="min-w-0"><p className="text-xs text-slate-500">送信先</p><p className="whitespace-nowrap text-base font-medium text-slate-900">{formatJPPhoneDisplay(phone)}</p></div>
          {!phoneSuccess && <button type="button" aria-label="番号を入力し直す" disabled={!!busy} onClick={() => { setCodeSent(false); setCode(""); setPhoneError(""); }} className="min-h-11 min-w-11 shrink-0 px-2 text-sm font-semibold text-slate-600 underline">変更</button>}
        </motion.div>}
      <SmoothCollapse open={codeSent || phoneSuccess}>
        <OtpCodeInput value={code} onChange={value => { setCode(value); setPhoneError(""); }} disabled={!!busy} confirmed={phoneSuccess} invalid={!!phoneError} />
        {!phoneSuccess && <button type="button" disabled={!!busy || resendCooldown.seconds > 0} onClick={() => void phoneAction(false)} className="mt-2 min-h-11 text-sm tabular-nums text-slate-600 underline disabled:text-slate-400 disabled:no-underline">{resendCooldown.seconds > 0 ? `再送まであと${resendCooldown.seconds}秒` : "コードを再送する"}</button>}
      </SmoothCollapse>
      {!required && <button type="button" disabled={!!busy || phoneSuccess || !phone.trim() || (codeSent ? code.length !== 6 : resendCooldown.seconds > 0)} onClick={() => void phoneAction(codeSent)} className={`${buttonClass} mt-4 w-full`}>{phoneSuccess ? "確認しました" : busy ? "確認中…" : codeSent ? "電話番号を確認" : resendCooldown.seconds > 0 ? `送信まであと${resendCooldown.seconds}秒` : "認証コードを送信"}</button>}
    </>}
    {phoneError && <p role="alert" className="mt-3 text-sm text-red-700">{phoneError}</p>}
  </section>;
  const bankSection = state && <section className={setupSectionClass}>
    {!required && <div className="mb-4 flex items-center justify-between gap-3"><h2 className="text-sm font-semibold text-slate-800">振込口座</h2><SetupBadge complete={hasSetupBank(state.bank)} completeLabel="登録済み" /></div>}
    {changingBank ? <>
      <BankSummary bank={state.bank} />
      <div className="mt-4 border-t border-slate-100 pt-3"><button type="button" disabled={!!busy || loading} onClick={() => void openBankChange()} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 disabled:opacity-50"><FontAwesomeIcon icon={faLock} className="w-3" />振込口座を変更</button><p className="mt-2 text-xs text-slate-500">変更時にパスキーで本人確認</p></div>
    </> : editingBank ? null : bankForm}
    {bankError && !editingBank && <p role="alert" className="mt-3 text-sm text-red-700">{bankError}</p>}
    {bankSaved && <p role="status" className="mt-3 text-sm text-green-700">{bankSaved}</p>}
  </section>;
  const status = <>
    {loadError && <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700"><p>登録状況を確認できませんでした。</p><button type="button" onClick={() => void retry()} disabled={loading || !!busy} className="mt-2 min-h-11 font-semibold underline">再読み込み</button></div>}
    {loading && !state && <p role="status" className="py-6 text-sm text-slate-500">登録状況を確認中…</p>}
  </>;
  const bankEditor = editingBank && state && typeof document !== "undefined" && <EditorModal title={bankReview ? "変更内容の確認" : "振込口座を変更"} variant="setup" fixedHeight onClose={cancelBank} dismissible={!busy} trapFocus footer={<div className="space-y-2">
    {state.hasPasskey && supported && <button type={bankReview ? "button" : "submit"} form={bankReview ? undefined : `${id}-bank-form`} disabled={!!busy || loading || loadError || !dirty} onClick={bankReview ? () => void saveBank() : undefined} className={`${buttonClass} w-full`}>{busy ? "本人確認・変更中…" : bankReview ? "パスキーで確認して変更" : "変更内容を確認"}</button>}
    {bankReview && <button type="button" disabled={!!busy} onClick={() => { setBankReview(false); setBankError(""); }} className="min-h-11 w-full text-sm text-slate-600">入力に戻る</button>}
    <button type="button" disabled={!!busy} onClick={cancelBank} className="min-h-11 w-full text-sm text-slate-600">変更を取り消す</button>
  </div>}>
    {!state.hasPasskey ? <div className="space-y-4"><p className="text-sm text-slate-700">口座を変更するには、パスキーの設定が必要です。</p>{required ? <p className="text-sm text-slate-600">運営にお問い合わせください。</p> : <button type="button" onClick={() => { setEditingBank(false); document.getElementById("passkey-settings")?.scrollIntoView({ behavior: "smooth" }); }} className="min-h-11 text-sm font-semibold underline">パスキーの設定へ</button>}</div>
      : !supported ? <p className="text-sm text-slate-700">パスキーを使えるSafariやChromeで開いてください。</p>
      : bankReview ? <div className="space-y-3"><BankSummary bank={bank} reveal compact /><p className="text-xs text-slate-600">今後の振込先をこの口座に変更します。</p></div>
      : <div className="space-y-3"><div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600"><p className="mb-1 font-semibold">登録中の口座</p><p className="truncate" title={`${state.bank.bankName} ${state.bank.bankBranch ?? ""} / 末尾 ${state.bank.bankNo.slice(-4)}`}>{state.bank.bankName} {state.bank.bankBranch} / 末尾 {state.bank.bankNo.slice(-4)}</p></div>{bankForm}</div>}
    {status}
    {bankError && <p role="alert" className="mt-3 text-sm text-red-700">{bankError}</p>}
    {bankError.includes("読み込み直") && <button type="button" disabled={!!busy || loading} onClick={async () => { await retry(); setBankReview(false); }} className="min-h-11 text-sm font-semibold underline">登録内容を再読み込み</button>}
    <ConfirmDialog open={discarding} title="変更を取り消す" message="入力した変更内容を破棄しますか？" confirmLabel="変更を破棄" cancelLabel="入力に戻る" tone="neutral" onClose={() => setDiscarding(false)} onConfirm={() => { setBank(state.bank); setEditingBank(false); setBankReview(false); setBankError(""); }} />
  </EditorModal>;
  if (!required) return <section className="mb-8" aria-label="登録情報"><h2 className="mb-3 text-base font-bold text-slate-900">登録情報</h2>{status}<div className="space-y-4">{phoneSection}{bankSection}</div>{bankEditor}</section>;
  const complete = !!state && state.profile.phoneVerified && hasSetupBank(state.bank) && !loadError;
  const blocked = !(entered && complete);
  const active = steps[stepIndex];
  const action = state && (phoneSuccess ? <button type="button" disabled className={`${buttonClass} w-full`}>確認しました</button>
    : complete ? <button key="complete" type="button" disabled={!!busy || loading || dirty} onClick={() => setEntered(true)} className={`${buttonClass} w-full`}>利用を開始する</button>
    : active === "phone" ? <button key="phone" type="button" disabled={!!busy || loading || !phone.trim() || (!state.profile.phoneVerified && (codeSent ? code.length !== 6 : resendCooldown.seconds > 0))} onClick={() => state.profile.phoneVerified ? setStepIndex(stepIndex + 1) : void phoneAction(codeSent)} className={`${buttonClass} w-full`}>{busy ? "確認中…" : state.profile.phoneVerified ? "次へ" : codeSent ? "電話番号を確認" : resendCooldown.seconds > 0 ? `送信まであと${resendCooldown.seconds}秒` : "認証コードを送信"}</button>
    : !changingBank ? <button key="bank" type="submit" form={`${id}-bank-form`} disabled={!!busy || loading || loadError} className={`${buttonClass} w-full`}>{busy === "bank" ? "保存中…" : "口座を登録して利用を開始"}</button> : null);
  const setupTitle = !state ? "登録状況を確認" : active === "phone" ? phoneSuccess ? "電話番号を認証しました" : codeSent ? "認証コードを入力してください" : "電話番号を入力してください" : "振込口座を登録してください";
  const progress = steps.length > 0 && <ol aria-label="登録の進み具合" className="flex items-center gap-2 text-xs">
    {steps.map((step, index) => <li key={step} aria-current={index === stepIndex ? "step" : undefined} className={`flex items-center gap-1 ${index === stepIndex ? "font-semibold text-slate-900" : "text-slate-500"}`}>
      {index > 0 && <span aria-hidden="true" className="h-px w-2 bg-slate-300" />}
      <span aria-hidden="true" className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-semibold ${index <= stepIndex ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500"}`}>{index + 1}</span>
      <span>{step === "phone" ? "電話番号の認証" : "口座情報の登録"}</span>
    </li>)}
  </ol>;
  const footer = <>{action}<div className="mt-3 flex min-h-11 items-center">{stepIndex > 0 && <button type="button" disabled={!!busy} onClick={() => setStepIndex(stepIndex - 1)} className="min-h-11 px-2 text-xs text-slate-600">戻る</button>}</div></>;
  return <>
    <div key={entered ? "ready" : "setup"} data-driver-setup-background inert={blocked || undefined} aria-hidden={blocked || undefined}>{children}</div>
    {blocked && typeof document !== "undefined" && <EditorModal title={setupTitle} header={progress} variant="setup" fixedHeight dismissible={false} onClose={() => {}} footer={footer}><div className="flex min-h-full flex-col justify-center">{status}<motion.div key={active} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={reduceMotion ? instantTransition : disclosureTransition}>{active === "phone" ? phoneSection : active === "bank" ? bankSection : null}</motion.div></div>{bankEditor}</EditorModal>}
  </>;
}
function BankSummary({ bank, reveal = false, compact = false }: { bank: BankAccount; reveal?: boolean; compact?: boolean }) {
  return <dl className={compact ? "space-y-2 text-xs" : "space-y-3 text-sm"}>{[[bank.bankBranch ? "銀行名" : "銀行・支店", bank.bankName], ...(bank.bankBranch ? [["支店名", bank.bankBranch]] : []), ...(bank.bankType ? [["口座種別", bankAccountTypeLabels[bank.bankType]]] : []), ["口座番号", reveal ? bank.bankNo : bank.bankNo ? `末尾 ${bank.bankNo.slice(-4)}` : ""], ["口座名義", bank.bankHolder]].map(([label, value]) => <div key={label} className={compact ? "grid grid-cols-[4rem_minmax(0,1fr)] gap-2" : "grid grid-cols-[5rem_minmax(0,1fr)] gap-3"}><dt className="text-slate-500">{label}</dt><dd className="break-words font-medium text-slate-900">{value || "未入力"}</dd></div>)}</dl>;
}
function SetupBadge({ complete, completeLabel = "完了" }: { complete: boolean; completeLabel?: string }) {
  return <span className={`flex shrink-0 items-center gap-1.5 text-xs font-medium ${complete ? "text-green-700" : "text-amber-800"}`}>{complete && <FontAwesomeIcon icon={faCircleCheck} className="w-3.5" />}{complete ? completeLabel : "未完了"}</span>;
}
