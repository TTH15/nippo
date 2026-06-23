"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faRotate, faCheck, faXmark, faUserPlus } from "@fortawesome/free-solid-svg-icons";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { Skeleton } from "@/lib/components/Skeleton";
import { ConfirmDialog } from "@/lib/components/ConfirmDialog";
import { ErrorDialog } from "@/lib/components/ErrorDialog";
import { apiFetch, getStoredDriver } from "@/lib/api";
import { getCompany } from "@/config/companies";
import { canAdminWrite } from "@/lib/authz";

// ============================================================
// ドライバーの参加・承認（Phase 7b）。
// 参加コード（join_code）の表示/再生成と、承認待ち（status='pending'）の承認/却下。
// 承認時に driver_code / 初期PIN を発行する（PUT /api/admin/users/[id]）。
// ============================================================

type Course = { id: string; name: string; color: string };
type PendingDriver = {
  id: string;
  name: string;
  phone: string | null;
  status: string;
  created_at: string | null;
};

export default function PendingApprovalPage() {
  const [canWrite, setCanWrite] = useState(false);
  const [companyCode, setCompanyCode] = useState<string>(getCompany(process.env.NEXT_PUBLIC_COMPANY_CODE).code || "");

  useEffect(() => {
    const d = getStoredDriver();
    setCanWrite(canAdminWrite(d?.role));
    if (d?.companyCode) setCompanyCode(d.companyCode);
  }, []);

  const { data: joinCodeRes, mutate: mutateJoinCode } = useSWR<{ joinCode: string | null }>(
    "/api/admin/join-code",
    (url: string) => apiFetch<{ joinCode: string | null }>(url),
    { revalidateOnFocus: false },
  );
  const { data: pendingRes, isLoading, mutate: mutatePending } = useSWR<{ drivers: PendingDriver[]; total: number }>(
    "/api/admin/users?status=pending&limit=100",
    (url: string) => apiFetch<{ drivers: PendingDriver[]; total: number }>(url),
    { revalidateOnFocus: false },
  );
  const { data: coursesRes } = useSWR<{ courses: Course[] }>(
    "/api/admin/courses",
    (url: string) => apiFetch<{ courses: Course[] }>(url),
    { revalidateOnFocus: false, dedupingInterval: 30 * 60 * 1000 },
  );
  const courses = coursesRes?.courses ?? [];
  const pending = pendingRes?.drivers ?? [];

  const [regenerating, setRegenerating] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [confirmReject, setConfirmReject] = useState<PendingDriver | null>(null);
  const [approveTarget, setApproveTarget] = useState<PendingDriver | null>(null);
  const [approveForm, setApproveForm] = useState({ driverNumber: "", officeCode: "", courseIds: [] as string[] });
  const [saving, setSaving] = useState(false);
  const [errorState, setErrorState] = useState<{ title: string; message: string } | null>(null);

  const regenerate = async () => {
    setRegenerating(true);
    try {
      const res = await apiFetch<{ joinCode: string }>("/api/admin/join-code", { method: "POST" });
      await mutateJoinCode({ joinCode: res.joinCode }, { revalidate: false });
    } catch (e) {
      setErrorState({ title: "再生成に失敗しました", message: e instanceof Error ? e.message : "不明なエラー" });
    } finally {
      setRegenerating(false);
    }
  };

  const openApprove = (d: PendingDriver) => {
    setApproveForm({ driverNumber: "", officeCode: "", courseIds: [] });
    setApproveTarget(d);
  };

  const submitApprove = async () => {
    if (!approveTarget) return;
    const num = approveForm.driverNumber.replace(/\D/g, "");
    const office = approveForm.officeCode.replace(/\D/g, "");
    if (num.length !== 6) {
      setErrorState({ title: "入力エラー", message: "ドライバー番号は6桁の数字で入力してください" });
      return;
    }
    if (office.length !== 6) {
      setErrorState({ title: "入力エラー", message: "事業所コードは6桁の数字で入力してください" });
      return;
    }
    setSaving(true);
    try {
      await apiFetch(`/api/admin/users/${approveTarget.id}`, {
        method: "PUT",
        body: JSON.stringify({
          status: "active",
          driverCode: `${companyCode}${num}`.toUpperCase(),
          officeCode: office,
          courseIds: approveForm.courseIds,
        }),
      });
      setApproveTarget(null);
      await mutatePending();
    } catch (e) {
      setErrorState({ title: "承認に失敗しました", message: e instanceof Error ? e.message : "不明なエラー" });
    } finally {
      setSaving(false);
    }
  };

  const reject = async (d: PendingDriver) => {
    try {
      await apiFetch(`/api/admin/users/${d.id}`, {
        method: "PUT",
        body: JSON.stringify({ status: "rejected" }),
      });
      await mutatePending();
    } catch (e) {
      setErrorState({ title: "却下に失敗しました", message: e instanceof Error ? e.message : "不明なエラー" });
    }
  };

  const toggleCourse = (cid: string) =>
    setApproveForm((f) => ({
      ...f,
      courseIds: f.courseIds.includes(cid) ? f.courseIds.filter((id) => id !== cid) : [...f.courseIds, cid],
    }));

  return (
    <AdminLayout>
      <div className="max-w-3xl mx-auto p-4 space-y-6">
        <div className="flex items-center gap-2">
          <FontAwesomeIcon icon={faUserPlus} className="h-5 w-5 text-slate-700" />
          <h1 className="text-lg font-bold text-slate-900">ドライバーの参加・承認</h1>
        </div>

        {/* 参加コード */}
        <section className="bg-white rounded-lg border border-slate-200 p-4">
          <h2 className="text-sm font-semibold text-slate-900 mb-2">参加コード</h2>
          <p className="text-xs text-slate-500 mb-3">
            このコードを参加者に伝えてください。参加者は「/join」で申請でき、承認すると利用開始できます。
          </p>
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center px-4 py-2 rounded-lg bg-slate-50 border border-slate-200 text-xl font-mono tracking-widest text-slate-900">
              {joinCodeRes?.joinCode ?? "—"}
            </span>
            {canWrite && (
              <button
                type="button"
                onClick={() => setConfirmRegen(true)}
                disabled={regenerating}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors"
              >
                <FontAwesomeIcon icon={faRotate} className="h-3.5 w-3.5" />
                {regenerating ? "再生成中..." : "再生成"}
              </button>
            )}
          </div>
        </section>

        {/* 承認待ち */}
        <section className="bg-white rounded-lg border border-slate-200 p-4">
          <h2 className="text-sm font-semibold text-slate-900 mb-3">
            承認待ち{pendingRes ? `（${pending.length}）` : ""}
          </h2>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : pending.length === 0 ? (
            <p className="text-sm text-slate-400 py-6 text-center">承認待ちの申請はありません</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {pending.map((d) => (
                <li key={d.id} className="py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">{d.name}</p>
                    <p className="text-xs text-slate-500">
                      {d.phone || "電話未登録"}
                      {d.created_at ? ` ・ ${new Date(d.created_at).toLocaleDateString("ja-JP")} 申請` : ""}
                    </p>
                  </div>
                  {canWrite && (
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => openApprove(d)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded bg-slate-900 text-white hover:bg-slate-800 transition-colors"
                      >
                        <FontAwesomeIcon icon={faCheck} className="h-3 w-3" />
                        承認
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmReject(d)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
                      >
                        <FontAwesomeIcon icon={faXmark} className="h-3 w-3" />
                        却下
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* 承認モーダル */}
      {approveTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !saving && setApproveTarget(null)}>
          <div className="bg-white rounded-lg shadow-lg w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 pt-5 pb-3 border-b border-slate-200">
              <h2 className="text-sm font-semibold text-slate-900">参加を承認</h2>
              <p className="text-xs text-slate-500 mt-1">
                {approveTarget.name}
                {approveTarget.phone ? ` ・ ${approveTarget.phone}` : ""}
              </p>
            </div>
            <div className="px-5 py-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">ドライバー番号（6桁）</label>
                <div className="flex">
                  <span className="inline-flex items-center px-3 py-2 border border-r-0 border-slate-200 bg-slate-50 rounded-l-lg text-sm font-mono text-slate-600 select-none">
                    {companyCode}
                  </span>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={approveForm.driverNumber}
                    onChange={(e) => setApproveForm((f) => ({ ...f, driverNumber: e.target.value.replace(/\D/g, "").slice(0, 6) }))}
                    className="w-full font-mono py-2 px-3 border border-slate-200 rounded-r-lg focus:border-slate-400 focus:outline-none"
                    placeholder="123456"
                    autoFocus
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">事業所コード（6桁）</label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={approveForm.officeCode}
                  onChange={(e) => setApproveForm((f) => ({ ...f, officeCode: e.target.value.replace(/\D/g, "").slice(0, 6) }))}
                  className="w-full font-mono py-2 px-3 border border-slate-200 rounded-lg focus:border-slate-400 focus:outline-none"
                  placeholder="000001"
                />
              </div>
              {courses.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">コース（任意）</label>
                  <div className="flex flex-wrap gap-2">
                    {courses.map((c) => {
                      const active = approveForm.courseIds.includes(c.id);
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => toggleCourse(c.id)}
                          className={`px-3 py-1.5 rounded text-sm font-medium border transition-colors ${
                            active ? "bg-slate-800 text-white border-slate-800" : "text-slate-600 border-slate-200 bg-white hover:bg-slate-50"
                          }`}
                        >
                          {c.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              <p className="text-xs text-slate-500">
                初期PINはドライバー番号と同じ6桁です（承認後にドライバー本人が変更できます）。
              </p>
            </div>
            <div className="px-5 py-3 flex justify-end gap-2 border-t border-slate-100">
              <button type="button" onClick={() => setApproveTarget(null)} disabled={saving} className="px-3 py-1.5 text-xs text-slate-600 hover:text-slate-800">
                キャンセル
              </button>
              <button
                type="button"
                onClick={submitApprove}
                disabled={saving}
                className="px-4 py-1.5 text-xs font-medium rounded bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50 transition-colors"
              >
                {saving ? "承認中..." : "承認して有効化"}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmRegen}
        title="参加コードを再生成"
        message="現在の参加コードは無効になります。共有済みの古いコードでは参加できなくなります。再生成しますか？"
        confirmLabel="再生成"
        onConfirm={regenerate}
        onClose={() => setConfirmRegen(false)}
      />
      <ConfirmDialog
        open={!!confirmReject}
        title="申請を却下"
        message={confirmReject ? `${confirmReject.name} の参加申請を却下しますか？` : ""}
        confirmLabel="却下"
        onConfirm={() => {
          if (confirmReject) reject(confirmReject);
        }}
        onClose={() => setConfirmReject(null)}
      />
      <ErrorDialog
        open={!!errorState}
        title={errorState?.title ?? ""}
        message={errorState?.message ?? ""}
        onClose={() => setErrorState(null)}
      />
    </AdminLayout>
  );
}
