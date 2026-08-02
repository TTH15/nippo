"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck, faXmark, faUserPlus, faIdCard, faCopy, faLink } from "@fortawesome/free-solid-svg-icons";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { Skeleton } from "@/lib/components/Skeleton";
import { ConfirmDialog } from "@/lib/components/ConfirmDialog";
import { ErrorDialog } from "@/lib/components/ErrorDialog";
import { apiFetch, getStoredDriver } from "@/lib/api";
import { getCompany } from "@/config/companies";
import { hasCapability } from "@/lib/capabilities";

// ============================================================
// ドライバーの参加・承認（Phase 7b → §2-1a 承認1回統合）。
// 単回招待リンクの発行（モーダル）と、承認待ち（status='pending'）の承認/却下。
// 参加の入口は個別リンク一本（共有 join_code の UI は 2026-08-02 撤去。API は互換のため残置）。
// 申請者は web ウィザードで KYC（免許・顔・住所・口座）まで提出してくるため、
// 承認モーダルで免許/顔を目視のうえ、承認1回で active 化＋本人確認（kyc_verified_at）まで行う
// （PUT /api/admin/users/[id] → POST verify-kyc）。KYC 未提出のまま承認した場合は
// 従来どおり「本人確認待ち」リストに現れる（移行中の既存ドライバーも同リスト）。
// ============================================================

type Course = { id: string; name: string; color: string };
type PendingDriver = {
  id: string;
  name: string;
  phone: string | null;
  status: string;
  created_at: string | null;
  faceUrl?: string | null;
  hasLicensePhoto?: boolean;
  hasFacePhoto?: boolean;
  kycComplete?: boolean;
};
type KycDriver = { id: string; name: string; phone: string | null; created_at: string | null };
type Invite = {
  id: string;
  name: string;
  token: string;
  createdAt: string;
  expiresAt: string;
  status: "active" | "used" | "expired" | "revoked";
};
type KycDetail = {
  name: string;
  nameKana: string;
  licenseUrl: string | null;
  faceUrl: string | null;
  licenseExpiry: string;
  dob: string;
  postalCode: string;
  address: string;
  addressMatchesLicense: boolean | null;
  bankName: string;
  bankNo: string;
  bankHolder: string;
};

// 住所の本人申告表示（true=免許記載と同一 / false=異なる=目視で要注意 / null=未申告）。
const addressAttestation = (v: boolean | null) =>
  v === null ? null : v ? (
    <span className="text-[11px] text-slate-400">免許記載と同一（本人申告）</span>
  ) : (
    <span className="text-[11px] font-medium text-amber-700">免許記載と異なる（本人申告・要確認）</span>
  );

export default function PendingApprovalPage() {
  const [canWrite, setCanWrite] = useState(false);
  const [companyCode, setCompanyCode] = useState<string>(getCompany(process.env.NEXT_PUBLIC_COMPANY_CODE).code || "");
  // 招待リンクの発行UIはモーダルに退避（主役は承認待ちリスト）。
  const [inviteModalOpen, setInviteModalOpen] = useState(false);

  useEffect(() => {
    const d = getStoredDriver();
    setCanWrite(hasCapability("can_approve_members"));
    if (d?.companyCode) setCompanyCode(d.companyCode);
  }, []);

  // 単回招待リンク（参加の唯一の入口・§2-1a）。共有参加コードの UI は 2026-08-02 撤去
  //（運用は個別リンク一本。/join?code= と join-code API は既存導線互換のため残置）。
  const { data: invitesRes, mutate: mutateInvites } = useSWR<{ invites: Invite[] }>(
    "/api/admin/invites",
    (url: string) => apiFetch<{ invites: Invite[] }>(url),
    { revalidateOnFocus: false },
  );
  // 使用済み・失効は表示しない（成果は承認待ちリスト側に現れる。履歴は DB に永続）。
  // 期限切れは「送ったのに使われなかった＝再発行する」の手掛かりとして残す。
  const invites = (invitesRes?.invites ?? []).filter((i) => i.status === "active" || i.status === "expired");
  const [inviteName, setInviteName] = useState("");
  const [inviteCreating, setInviteCreating] = useState(false);
  const [copiedInviteId, setCopiedInviteId] = useState<string | null>(null);

  const inviteUrlOf = (token: string) =>
    typeof window === "undefined" ? "" : `${window.location.origin}/join?invite=${token}`;

  const createInvite = async () => {
    setInviteCreating(true);
    try {
      const res = await apiFetch<{ invite: Invite }>("/api/admin/invites", {
        method: "POST",
        body: JSON.stringify({ name: inviteName.trim() }),
      });
      setInviteName("");
      // POST の返り値でキャッシュを直接更新し、一覧へ即時反映する（再取得の往復を待たない）。
      await mutateInvites(
        (prev) => ({ invites: [res.invite, ...(prev?.invites ?? [])] }),
        { revalidate: false },
      );
    } catch (e) {
      setErrorState({ title: "招待の発行に失敗しました", message: e instanceof Error ? e.message : "不明なエラー" });
    } finally {
      setInviteCreating(false);
    }
  };

  const copyInviteLink = async (inv: Invite) => {
    try {
      await navigator.clipboard.writeText(inviteUrlOf(inv.token));
      setCopiedInviteId(inv.id);
      setTimeout(() => setCopiedInviteId((prev) => (prev === inv.id ? null : prev)), 1500);
    } catch {
      // クリップボード不可の環境では無視
    }
  };

  const revokeInvite = async (inv: Invite) => {
    try {
      await apiFetch(`/api/admin/invites/${inv.id}`, { method: "DELETE" });
      // 失効した行は一覧に出ないため、キャッシュから外すだけで整合する。
      await mutateInvites(
        (prev) => ({ invites: (prev?.invites ?? []).filter((i) => i.id !== inv.id) }),
        { revalidate: false },
      );
    } catch (e) {
      setErrorState({ title: "失効に失敗しました", message: e instanceof Error ? e.message : "不明なエラー" });
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

  const [confirmReject, setConfirmReject] = useState<PendingDriver | null>(null);
  const [approveTarget, setApproveTarget] = useState<PendingDriver | null>(null);
  const [approveForm, setApproveForm] = useState({ driverNumber: "", officeCode: "", courseIds: [] as string[] });
  const [saving, setSaving] = useState(false);
  const [errorState, setErrorState] = useState<{ title: string; message: string } | null>(null);
  const [kycTarget, setKycTarget] = useState<KycDriver | null>(null);
  const [kycDetail, setKycDetail] = useState<KycDetail | null>(null);
  const [kycLoading, setKycLoading] = useState(false);
  const [confirmKycReject, setConfirmKycReject] = useState<KycDriver | null>(null);
  // 承認モーダル内の KYC レビュー（承認1回統合）。can_view_pii が無い場合は null のまま。
  const [approveKyc, setApproveKyc] = useState<KycDetail | null>(null);
  const [approveKycLoading, setApproveKycLoading] = useState(false);

  const openApprove = (d: PendingDriver) => {
    setApproveForm({ driverNumber: "", officeCode: "", courseIds: [] });
    setApproveKyc(null);
    setApproveTarget(d);
    // KYC（免許/顔）を提出済みなら、承認モーダル内で目視レビューできるよう取得する。
    // 閲覧には can_view_pii が必要（無いロールはレビューなしの active 化のみ）。
    if ((d.hasLicensePhoto || d.hasFacePhoto) && hasCapability("can_view_pii")) {
      setApproveKycLoading(true);
      apiFetch<KycDetail>(`/api/admin/users/${d.id}/kyc`)
        .then(setApproveKyc)
        .catch(() => setApproveKyc(null))
        .finally(() => setApproveKycLoading(false));
    }
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
      // 承認1回統合: 免許と顔をこのモーダルで目視済みなら、そのまま本人確認まで完了させる。
      // 失敗しても active 化は成立しており「本人確認待ち」リストで拾えるため、エラーは通知のみ。
      if (approveKyc?.licenseUrl && approveKyc?.faceUrl) {
        try {
          await apiFetch(`/api/admin/users/${approveTarget.id}/verify-kyc`, {
            method: "POST",
            body: JSON.stringify({ action: "approve" }),
          });
        } catch (e) {
          setErrorState({
            title: "本人確認の記録に失敗しました",
            message: `参加は承認済みです。「本人確認待ち」から本人確認をやり直してください。（${e instanceof Error ? e.message : "不明なエラー"}）`,
          });
        }
      }
      setApproveTarget(null);
      setApproveKyc(null);
      await Promise.all([mutatePending(), mutateKyc()]);
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
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <FontAwesomeIcon icon={faUserPlus} className="h-5 w-5 text-slate-700" />
            <h1 className="text-lg font-bold text-slate-900">ドライバーの参加・承認</h1>
          </div>
          {/* 招待の発行は右上に小さく。主役は下の承認待ちリスト */}
          <button
            type="button"
            onClick={() => setInviteModalOpen(true)}
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
          >
            <FontAwesomeIcon icon={faLink} className="h-3 w-3" />
            招待リンク
          </button>
        </div>

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
                  {/* 提出済みの顔写真をアバター表示（対面済みの運営が「誰か」を直感できるように） */}
                  {d.faceUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={d.faceUrl}
                      alt={`${d.name} の顔写真`}
                      className="w-11 h-11 rounded-full object-cover border border-slate-200 shrink-0"
                    />
                  ) : (
                    <div className="w-11 h-11 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-sm font-bold text-slate-400 shrink-0">
                      {d.name.charAt(0)}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-900 truncate">{d.name}</p>
                    <p className="text-xs text-slate-500">
                      {d.phone || "電話未登録"}
                      {d.created_at ? ` ・ ${new Date(d.created_at).toLocaleDateString("ja-JP")} 申請` : ""}
                    </p>
                    <span
                      className={`inline-block mt-1 px-1.5 py-0.5 rounded text-[11px] font-medium ${
                        d.kycComplete
                          ? "bg-emerald-50 text-emerald-700"
                          : d.hasLicensePhoto || d.hasFacePhoto
                            ? "bg-amber-50 text-amber-700"
                            : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {d.kycComplete ? "本登録 提出済み" : d.hasLicensePhoto || d.hasFacePhoto ? "本登録 入力中" : "本登録 未提出"}
                    </span>
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

        {/* 本人確認待ち（本承認）。承認1回統合後は「KYC未提出のまま承認した」場合だけ使う
            フォールバックのため、対象がいるときのみ表示する */}
        {kycList.length > 0 && (
        <section className="bg-white rounded-lg border border-slate-200 p-4">
          <h2 className="text-sm font-semibold text-slate-900 mb-1">
            本人確認待ち{kycRes ? `（${kycList.length}）` : ""}
          </h2>
          <p className="text-xs text-slate-500 mb-3">
            本登録（免許証・顔写真）を提出したドライバーです。免許・顔を確認して本承認してください。
          </p>
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
        </section>
        )}
      </div>

      {/* 招待リンクのモーダル（発行は右上ボタンから。参加の入口は個別リンク一本） */}
      {inviteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setInviteModalOpen(false)}>
          <div className="bg-white rounded-lg shadow-lg w-full max-w-lg max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 pt-5 pb-3 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">招待リンク（1人につき1回）</h2>
              <button type="button" onClick={() => setInviteModalOpen(false)} className="px-2 py-1 text-xs text-slate-500 hover:text-slate-800">
                閉じる
              </button>
            </div>
            <div className="px-5 py-4">
        <section>
          <p className="text-xs text-slate-500 mb-3">
            参加者ごとにリンクを発行して LINE や SMS で送ってください。リンクは1回使うと無効になります（有効期限7日）。
            開いた本人は氏名・電話認証から免許・顔写真の提出まで web で完結し、最後にアプリのインストールを案内されます。
          </p>
          {canWrite && (
            <div className="flex gap-2 mb-3">
              <input
                type="text"
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
                className="flex-1 min-w-0 py-2 px-3 text-sm rounded-lg border border-slate-200 focus:border-slate-400 focus:outline-none"
                placeholder="宛先メモ（任意・管理用。本人には表示されません）"
              />
              <button
                type="button"
                onClick={createInvite}
                disabled={inviteCreating}
                className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50 transition-colors"
              >
                <FontAwesomeIcon icon={faUserPlus} className="h-3.5 w-3.5" />
                {inviteCreating ? "発行中..." : "リンクを発行"}
              </button>
            </div>
          )}
          {invites.length === 0 ? (
            <p className="text-sm text-slate-400 py-3 text-center">発行済みの招待はありません</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {invites.map((inv) => (
                <li key={inv.id} className="py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-slate-900 truncate">{inv.name || "（メモなし）"}</p>
                    <p className="text-xs text-slate-500">
                      {inv.status === "active"
                        ? `有効 ・ ${new Date(inv.expiresAt).toLocaleDateString("ja-JP")} まで`
                        : "期限切れ"}
                    </p>
                  </div>
                  {inv.status === "active" && (
                    <div className="flex items-center gap-2 shrink-0">
                      {/* コピーはアイコンのみ。コピー済みはチェックを緑にして遷移を見せる */}
                      <button
                        type="button"
                        onClick={() => copyInviteLink(inv)}
                        title="リンクをコピー"
                        aria-label="リンクをコピー"
                        className={`inline-flex items-center justify-center w-8 h-8 rounded border transition-all duration-300 ease-out ${
                          copiedInviteId === inv.id
                            ? "border-emerald-300 bg-emerald-50 text-emerald-600 scale-105"
                            : "border-slate-200 text-slate-700 hover:bg-slate-50"
                        }`}
                      >
                        <FontAwesomeIcon
                          icon={copiedInviteId === inv.id ? faCheck : faCopy}
                          className="h-3.5 w-3.5 transition-transform duration-300 ease-out"
                        />
                      </button>
                      {canWrite && (
                        <button
                          type="button"
                          onClick={() => revokeInvite(inv)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors"
                        >
                          <FontAwesomeIcon icon={faXmark} className="h-3 w-3" />
                          失効
                        </button>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
            </div>
          </div>
        </div>
      )}

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
                    <div className="flex justify-between gap-3"><span className="text-slate-500">フリガナ</span><span className="text-slate-900">{kycDetail.nameKana || "—"}</span></div>
                    <div className="flex justify-between gap-3"><span className="text-slate-500">有効期限</span><span className="text-slate-900">{kycDetail.licenseExpiry || "—"}</span></div>
                    <div className="flex justify-between gap-3"><span className="text-slate-500">生年月日</span><span className="text-slate-900">{kycDetail.dob || "—"}</span></div>
                    <div className="flex justify-between gap-3"><span className="text-slate-500">住所</span><span className="text-slate-900 text-right">〒{kycDetail.postalCode} {kycDetail.address}</span></div>
                    {addressAttestation(kycDetail.addressMatchesLicense) && (
                      <div className="text-right">{addressAttestation(kycDetail.addressMatchesLicense)}</div>
                    )}
                    {kycDetail.bankName && (
                      <div className="flex justify-between gap-3"><span className="text-slate-500">口座</span><span className="text-slate-900 text-right">{kycDetail.bankName} / {kycDetail.bankNo} / {kycDetail.bankHolder}</span></div>
                    )}
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

      {/* 承認モーダル（KYC 目視レビュー＋driver_code 割り当て → 承認1回で完了） */}
      {approveTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !saving && setApproveTarget(null)}>
          <div className="bg-white rounded-lg shadow-lg w-full max-w-md max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 pt-5 pb-3 border-b border-slate-200">
              <h2 className="text-sm font-semibold text-slate-900">参加を承認</h2>
              <p className="text-xs text-slate-500 mt-1">
                {approveTarget.name}
                {approveTarget.phone ? ` ・ ${approveTarget.phone}` : ""}
              </p>
            </div>
            <div className="px-5 py-4 space-y-4">
              {approveKycLoading ? (
                <p className="text-sm text-slate-400 py-4 text-center">本人確認情報を読み込み中...</p>
              ) : approveKyc ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-xs text-slate-500 mb-1">免許証</p>
                      {approveKyc.licenseUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={approveKyc.licenseUrl} alt="免許証" className="w-full rounded border border-slate-200" />
                      ) : (
                        <p className="text-xs text-slate-400">未提出</p>
                      )}
                    </div>
                    <div>
                      <p className="text-xs text-slate-500 mb-1">顔写真</p>
                      {approveKyc.faceUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={approveKyc.faceUrl} alt="顔写真" className="w-full rounded border border-slate-200" />
                      ) : (
                        <p className="text-xs text-slate-400">未提出</p>
                      )}
                    </div>
                  </div>
                  <div className="text-sm space-y-1.5">
                    <div className="flex justify-between gap-3"><span className="text-slate-500">フリガナ</span><span className="text-slate-900">{approveKyc.nameKana || "—"}</span></div>
                    <div className="flex justify-between gap-3"><span className="text-slate-500">有効期限</span><span className="text-slate-900">{approveKyc.licenseExpiry || "—"}</span></div>
                    <div className="flex justify-between gap-3"><span className="text-slate-500">生年月日</span><span className="text-slate-900">{approveKyc.dob || "—"}</span></div>
                    <div className="flex justify-between gap-3"><span className="text-slate-500">住所</span><span className="text-slate-900 text-right">〒{approveKyc.postalCode} {approveKyc.address}</span></div>
                    {addressAttestation(approveKyc.addressMatchesLicense) && (
                      <div className="text-right">{addressAttestation(approveKyc.addressMatchesLicense)}</div>
                    )}
                    {approveKyc.bankName && (
                      <div className="flex justify-between gap-3"><span className="text-slate-500">口座</span><span className="text-slate-900 text-right">{approveKyc.bankName} / {approveKyc.bankNo} / {approveKyc.bankHolder}</span></div>
                    )}
                  </div>
                  <hr className="border-slate-100" />
                </div>
              ) : (
                <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
                  本登録（免許・顔写真）が未提出です。承認すると参加は有効になりますが、本人確認は提出後に「本人確認待ち」から行ってください。
                </p>
              )}
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
                {approveKyc?.licenseUrl && approveKyc?.faceUrl
                  ? "承認するとドライバー番号を割り当て、本人確認（免許・顔の目視）まで完了します。本人はアプリをインストールしてすぐ業務を開始できます。"
                  : "承認するとドライバー番号を割り当てます。本人確認は本登録の提出後に「本人確認待ち」から行ってください。"}
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
                {saving ? "承認中..." : approveKyc?.licenseUrl && approveKyc?.faceUrl ? "確認して承認" : "承認して有効化"}
              </button>
            </div>
          </div>
        </div>
      )}

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
