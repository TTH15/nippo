"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import QRCode from "qrcode";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faRotate, faCheck, faXmark, faUserPlus, faIdCard, faCopy } from "@fortawesome/free-solid-svg-icons";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { Skeleton } from "@/lib/components/Skeleton";
import { ConfirmDialog } from "@/lib/components/ConfirmDialog";
import { ErrorDialog } from "@/lib/components/ErrorDialog";
import { apiFetch, getStoredDriver } from "@/lib/api";
import { getCompany } from "@/config/companies";
import { hasCapability } from "@/lib/capabilities";

// ============================================================
// ドライバーの参加・承認（Phase 7b）。
// 参加コード（join_code）の表示/再生成と、承認待ち（status='pending'）の承認/却下。
// 承認時に driver_code を割り当てる（PUT /api/admin/users/[id]）。初期PINは発行しない
// （PIN撤廃・§2-1a）。本人は電話OTPでログイン→Passkey登録する。
// ============================================================

type Course = { id: string; name: string; color: string };
type PendingDriver = {
  id: string;
  name: string;
  phone: string | null;
  status: string;
  created_at: string | null;
};
type KycDriver = { id: string; name: string; phone: string | null; created_at: string | null };
type KycDetail = {
  name: string;
  licenseUrl: string | null;
  faceUrl: string | null;
  licenseExpiry: string;
  dob: string;
  postalCode: string;
  address: string;
  bankName: string;
  bankNo: string;
  bankHolder: string;
};

export default function PendingApprovalPage() {
  const [canWrite, setCanWrite] = useState(false);
  const [companyCode, setCompanyCode] = useState<string>(getCompany(process.env.NEXT_PUBLIC_COMPANY_CODE).code || "");
  const [inviteUrl, setInviteUrl] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const d = getStoredDriver();
    setCanWrite(hasCapability("can_approve_members"));
    if (d?.companyCode) setCompanyCode(d.companyCode);
  }, []);

  const { data: joinCodeRes, mutate: mutateJoinCode } = useSWR<{ joinCode: string | null }>(
    "/api/admin/join-code",
    (url: string) => apiFetch<{ joinCode: string | null }>(url),
    { revalidateOnFocus: false },
  );

  // 招待リンク（?code=）と QR を join_code から生成。deferred deep link は使わず web で完結（§2-1a）。
  const joinCode = joinCodeRes?.joinCode ?? null;
  useEffect(() => {
    if (!joinCode) {
      setInviteUrl("");
      setQrDataUrl("");
      return;
    }
    const url = `${window.location.origin}/join?code=${encodeURIComponent(joinCode)}`;
    setInviteUrl(url);
    QRCode.toDataURL(url, { width: 320, margin: 1, errorCorrectionLevel: "M" })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(""));
  }, [joinCode]);

  const copyInvite = async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // クリップボード不可の環境では無視（URL は表示済み）
    }
  };
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
  const { data: kycRes, mutate: mutateKyc } = useSWR<{ drivers: KycDriver[]; total: number }>(
    "/api/admin/users?stage=kyc",
    (url: string) => apiFetch<{ drivers: KycDriver[]; total: number }>(url),
    { revalidateOnFocus: false },
  );
  const courses = coursesRes?.courses ?? [];
  const pending = pendingRes?.drivers ?? [];
  const kycList = kycRes?.drivers ?? [];

  const [regenerating, setRegenerating] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [confirmReject, setConfirmReject] = useState<PendingDriver | null>(null);
  const [approveTarget, setApproveTarget] = useState<PendingDriver | null>(null);
  const [approveForm, setApproveForm] = useState({ driverNumber: "", officeCode: "", courseIds: [] as string[] });
  const [saving, setSaving] = useState(false);
  const [errorState, setErrorState] = useState<{ title: string; message: string } | null>(null);
  const [kycTarget, setKycTarget] = useState<KycDriver | null>(null);
  const [kycDetail, setKycDetail] = useState<KycDetail | null>(null);
  const [kycLoading, setKycLoading] = useState(false);
  const [confirmKycReject, setConfirmKycReject] = useState<KycDriver | null>(null);

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

  const openKycReview = async (d: KycDriver) => {
    setKycTarget(d);
    setKycDetail(null);
    setKycLoading(true);
    try {
      const detail = await apiFetch<KycDetail>(`/api/admin/users/${d.id}/kyc`);
      setKycDetail(detail);
    } catch (e) {
      setErrorState({ title: "取得に失敗しました", message: e instanceof Error ? e.message : "不明なエラー" });
      setKycTarget(null);
    } finally {
      setKycLoading(false);
    }
  };

  const verifyKyc = async (action: "approve" | "reject") => {
    if (!kycTarget) return;
    setSaving(true);
    try {
      await apiFetch(`/api/admin/users/${kycTarget.id}/verify-kyc`, {
        method: "POST",
        body: JSON.stringify({ action }),
      });
      setKycTarget(null);
      setKycDetail(null);
      await mutateKyc();
    } catch (e) {
      setErrorState({ title: action === "approve" ? "本承認に失敗しました" : "却下に失敗しました", message: e instanceof Error ? e.message : "不明なエラー" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminLayout>
      <div className="max-w-3xl mx-auto p-4 space-y-6">
        <div className="flex items-center gap-2">
          <FontAwesomeIcon icon={faUserPlus} className="h-5 w-5 text-slate-700" />
          <h1 className="text-lg font-bold text-slate-900">ドライバーの参加・承認</h1>
        </div>

        {/* 参加コード */}
        <section className="bg-white rounded-lg border border-slate-200 p-4">
          <h2 className="text-sm font-semibold text-slate-900 mb-2">参加コード・招待リンク</h2>
          <p className="text-xs text-slate-500 mb-3">
            招待リンク（または QR）を参加者に送ってください。開くと参加コードが自動入力されます。リンクを開けない場合はコードを口頭で伝えても申請できます。承認後に本人確認が完了すると利用開始できます。
          </p>
          <div className="flex items-center gap-3 mb-4">
            <span className="inline-flex items-center px-4 py-2 rounded-lg bg-slate-50 border border-slate-200 text-xl font-mono tracking-widest text-slate-900">
              {joinCode ?? "—"}
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

          {inviteUrl && (
            <div className="flex flex-col sm:flex-row gap-4 sm:items-center">
              <div className="flex-1 min-w-0">
                <label className="block text-xs font-medium text-slate-500 mb-1">招待リンク</label>
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    value={inviteUrl}
                    onFocus={(e) => e.currentTarget.select()}
                    className="flex-1 min-w-0 py-2 px-3 text-xs font-mono rounded-lg bg-slate-50 border border-slate-200 text-slate-700"
                  />
                  <button
                    type="button"
                    onClick={copyInvite}
                    className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors"
                  >
                    <FontAwesomeIcon icon={copied ? faCheck : faCopy} className="h-3.5 w-3.5" />
                    {copied ? "コピーしました" : "コピー"}
                  </button>
                </div>
              </div>
              {qrDataUrl && (
                <div className="flex flex-col items-center gap-1">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={qrDataUrl} alt="招待QRコード" className="w-32 h-32 rounded-lg border border-slate-200 bg-white" />
                  <span className="text-[11px] text-slate-400">QRで読み取り</span>
                </div>
              )}
            </div>
          )}
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

        {/* 本人確認待ち（本承認） */}
        <section className="bg-white rounded-lg border border-slate-200 p-4">
          <h2 className="text-sm font-semibold text-slate-900 mb-1">
            本人確認待ち{kycRes ? `（${kycList.length}）` : ""}
          </h2>
          <p className="text-xs text-slate-500 mb-3">
            本登録（免許証・顔写真）を提出したドライバーです。免許・顔を確認して本承認してください。
          </p>
          {kycList.length === 0 ? (
            <p className="text-sm text-slate-400 py-6 text-center">本人確認待ちはありません</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {kycList.map((d) => (
                <li key={d.id} className="py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">{d.name}</p>
                    <p className="text-xs text-slate-500">
                      {d.phone || "電話未登録"}
                      {d.created_at ? ` ・ ${new Date(d.created_at).toLocaleDateString("ja-JP")} 申請` : ""}
                    </p>
                  </div>
                  {canWrite && (
                    <button
                      type="button"
                      onClick={() => openKycReview(d)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded bg-slate-900 text-white hover:bg-slate-800 transition-colors"
                    >
                      <FontAwesomeIcon icon={faIdCard} className="h-3 w-3" />
                      確認
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* 本人確認モーダル */}
      {kycTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !saving && setKycTarget(null)}>
          <div className="bg-white rounded-lg shadow-lg w-full max-w-lg max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 pt-5 pb-3 border-b border-slate-200">
              <h2 className="text-sm font-semibold text-slate-900">本人確認</h2>
              <p className="text-xs text-slate-500 mt-1">{kycTarget.name}</p>
            </div>
            <div className="px-5 py-4 space-y-4">
              {kycLoading || !kycDetail ? (
                <p className="text-sm text-slate-400 py-8 text-center">読み込み中...</p>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-xs text-slate-500 mb-1">免許証</p>
                      {kycDetail.licenseUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={kycDetail.licenseUrl} alt="免許証" className="w-full rounded border border-slate-200" />
                      ) : (
                        <p className="text-xs text-slate-400">未提出</p>
                      )}
                    </div>
                    <div>
                      <p className="text-xs text-slate-500 mb-1">顔写真</p>
                      {kycDetail.faceUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={kycDetail.faceUrl} alt="顔写真" className="w-full rounded border border-slate-200" />
                      ) : (
                        <p className="text-xs text-slate-400">未提出</p>
                      )}
                    </div>
                  </div>
                  <div className="text-sm space-y-1.5">
                    <div className="flex justify-between gap-3"><span className="text-slate-500">有効期限</span><span className="text-slate-900">{kycDetail.licenseExpiry || "—"}</span></div>
                    <div className="flex justify-between gap-3"><span className="text-slate-500">生年月日</span><span className="text-slate-900">{kycDetail.dob || "—"}</span></div>
                    <div className="flex justify-between gap-3"><span className="text-slate-500">住所</span><span className="text-slate-900 text-right">〒{kycDetail.postalCode} {kycDetail.address}</span></div>
                    <div className="flex justify-between gap-3"><span className="text-slate-500">口座</span><span className="text-slate-900 text-right">{kycDetail.bankName} / {kycDetail.bankNo} / {kycDetail.bankHolder}</span></div>
                  </div>
                </>
              )}
            </div>
            {canWrite && (
              <div className="px-5 py-3 flex justify-end gap-2 border-t border-slate-100">
                <button type="button" onClick={() => setConfirmKycReject(kycTarget)} disabled={saving} className="px-3 py-1.5 text-xs text-red-600 hover:text-red-800">
                  却下
                </button>
                <button
                  type="button"
                  onClick={() => verifyKyc("approve")}
                  disabled={saving || !kycDetail}
                  className="px-4 py-1.5 text-xs font-medium rounded bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50 transition-colors"
                >
                  {saving ? "処理中..." : "本承認する"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

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
                承認するとドライバー番号を割り当てます。本人は登録した電話番号でログインし、続けて本登録（免許・顔写真など）に進みます。
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
      <ConfirmDialog
        open={!!confirmKycReject}
        title="本人確認を却下"
        message={confirmKycReject ? `${confirmKycReject.name} を却下しますか？（申請は却下扱いになります）` : ""}
        confirmLabel="却下"
        onConfirm={() => verifyKyc("reject")}
        onClose={() => setConfirmKycReject(null)}
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
