"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch, forgetLoginSession, getAdminToken } from "@/lib/api";
import { registerPasskey } from "@/lib/registerPasskey";
import { useIsWebAuthnHost } from "@/lib/webauthnHost";
import { reauthHeaders, useRecentAuthAction } from "./RecentAuth";
import { PasskeySetup } from "./PasskeySetup";
import { ConfirmDialog } from "./ConfirmDialog";
import { formatDateSlashWeekdayJP } from "@repo/core/logic/calendar";

const primary = "min-h-11 w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50";
type Recovery = { id: string; status: "pending" | "approved" | "rejected" | "completed" | "expired"; expiresAt: string };
export function AccountRecovery({ onContinue }: { onContinue: () => void }) {
  const supported = useIsWebAuthnHost();
  const [request, setRequest] = useState<Recovery | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const reauth = useRecentAuthAction({ recovery: true });
  const load = async () => {
    setBusy(true); setError("");
    try { setRequest((await apiFetch<{ request: Recovery | null }>("/api/auth/recovery-request")).request); }
    catch (error) { setError(error instanceof Error ? error.message : "申請を確認できませんでした"); }
    finally { setBusy(false); }
  };
  useEffect(() => { void load(); }, []);
  const pending = request?.status === "pending";
  const approved = request?.status === "approved";
  return <div className="space-y-4">
    {pending ? <>
      <h2 className="text-base font-semibold text-slate-900">管理者の承認待ち</h2>
      <p className="text-sm text-slate-600">別の管理者にアカウント設定からの承認を依頼してください。管理者が1人の場合は運営窓口へ連絡してください。</p>
      <button type="button" disabled={busy} onClick={load} className={primary}>{busy ? "確認中..." : "承認状況を確認する"}</button>
    </> : <>
      {approved && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">承認済み（有効期限 {new Date(request.expiresAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })}）</p>}
      <PasskeySetup key={approved ? request.id : "normal"} verifyIdentity required recovery={approved}
        supported={supported} requiredMessage={approved ? "" : "登録済みのパスキーで本人確認してください。"} continueLabel="運営ログインへ"
        register={(grant) => registerPasskey(grant, approved ? request.id : undefined)} onContinue={onContinue} />
      {!approved && <>
        {(request?.status === "expired" || request?.status === "rejected" || request?.status === "completed") && <p role="status" className="text-sm text-amber-800">{request.status === "rejected" ? "復旧は承認されませんでした。管理者または運営窓口へ確認してください。" : "復旧の有効期限が切れています。もう一度申請してください。"}</p>}
        {reauth.verification}
        <button type="button" disabled={busy || reauth.checking || reauth.verifying} className="min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-50"
          onClick={() => reauth.run(async (grant) => {
            const result = await apiFetch<{ request: Recovery }>("/api/auth/recovery-request", { method: "POST", headers: reauthHeaders(grant) });
            setRequest(result.request);
          })}>使えるパスキーがないため復旧を申請する</button>
      </>}
    </>}
    {approved && <button type="button" disabled={busy} onClick={load} className="min-h-11 w-full text-sm underline">承認状況を確認する</button>}
    {error && <div role="alert" className="text-sm text-red-700"><p>{error}</p><button type="button" disabled={busy} onClick={load} className="min-h-11 underline">もう一度読み込む</button></div>}
  </div>;
}

type PendingRequest = { id: string; name: string; companyName?: string; requestedAt: string; isSelf: boolean };
export function RecoveryApprovals({ platform = false }: { platform?: boolean }) {
  const endpoint = platform ? "/api/platform/account-recovery" : "/api/admin/account-recovery";
  const [requests, setRequests] = useState<PendingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<{ request: PendingRequest; approve: boolean } | null>(null);
  const reauth = useRecentAuthAction();
  const load = async () => {
    setLoading(true); setError("");
    try { setRequests((await apiFetch<{ requests: PendingRequest[] }>(endpoint)).requests); }
    catch (error) { setError(error instanceof Error ? error.message : "申請を読み込めませんでした"); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [endpoint]);
  return <section className="mt-8 space-y-3">
    <h2 className="text-base font-bold text-slate-900">パスキー復旧の承認</h2>
    {loading && <p role="status" className="text-sm text-slate-500">申請を確認中...</p>}
    {requests.length === 0 && !error && !loading && <p className="text-sm text-slate-500">承認待ちの申請はありません。</p>}
    <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white px-4">
      {requests.map(request => <li key={request.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
        <div className="min-w-0 text-sm"><p className="break-words font-medium">{request.name}</p>
          {platform && <p>{request.companyName}</p>}
          <p className="text-xs text-slate-500">{formatDateSlashWeekdayJP(new Date(request.requestedAt).toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }))}</p></div>
        {request.isSelf ? <p className="text-sm text-slate-500">自分の申請は承認できません</p> : <div className="flex gap-2">
          <button type="button" disabled={loading || reauth.checking || reauth.verifying} onClick={() => setSelected({ request, approve: false })} className="min-h-11 rounded-lg border px-3 text-sm">却下</button>
          <button type="button" disabled={loading || reauth.checking || reauth.verifying} onClick={() => setSelected({ request, approve: true })} className="min-h-11 rounded-lg bg-slate-900 px-3 text-sm text-white">承認</button>
        </div>}
      </li>)}
    </ul>
    <ConfirmDialog open={!!selected} title={selected?.approve ? "復旧を承認しますか？" : "復旧を却下しますか？"}
      message={selected?.approve ? `${selected.request.name}さん本人からの依頼であることを、対面や登録済みの連絡先で確認してください。承認後は新しいパスキーで運営画面へログインできるようになります。` : "申請者はパスキーを追加できません。"}
      confirmLabel={selected?.approve ? "本人を確認して承認する" : "却下する"} onClose={() => setSelected(null)} onConfirm={() => {
        const decision = selected; setSelected(null);
        if (!decision) return;
        void reauth.run(async grant => { await apiFetch(endpoint, { method: "POST", headers: reauthHeaders(grant), body: JSON.stringify({ id: decision.request.id, approve: decision.approve }) }); await load(); });
      }} />
    {reauth.verification}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <button type="button" disabled={loading} onClick={load} className="min-h-11 text-sm underline disabled:opacity-50">申請を更新する</button>
  </section>;
}

export function RevokeAllSessions() {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const reauth = useRecentAuthAction({ recovery: true });
  return <section className="mt-8 space-y-3">
    <h2 className="text-base font-bold text-slate-900">ログイン中の端末</h2>
    {reauth.verification}
    <button type="button" disabled={reauth.checking || reauth.verifying} onClick={() => setConfirming(true)} className="min-h-11 rounded-lg border border-red-200 bg-white px-4 text-sm text-red-700">すべての端末からログアウト</button>
    <ConfirmDialog open={confirming} title="すべての端末からログアウトしますか？" message="この端末を含む、すべての端末でログインし直す必要があります。"
      confirmLabel="すべてログアウトする" onClose={() => setConfirming(false)} onConfirm={() => {
        setConfirming(false);
        void reauth.run(async grant => {
          await apiFetch("/api/me/sessions/revoke-all", { method: "POST", headers: reauthHeaders(grant), body: JSON.stringify({ adminToken: getAdminToken() }) });
          forgetLoginSession(); router.push("/login");
        });
      }} />
  </section>;
}
