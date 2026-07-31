"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

// 運営社オンボーディング申請の審査（§2-5 ハイタッチフローの台帳）。
// 承認すると org がブートストラップされ、参加コードと初代 ADMIN 招待リンクが一度だけ表示される。

type Application = {
  id: string;
  company_name: string;
  corporate_number: string | null;
  representative: string | null;
  contact_name: string | null;
  contact_email: string;
  contact_phone: string | null;
  address: string | null;
  message: string | null;
  status: "pending" | "reviewing" | "approved" | "rejected";
  created_at: string;
  decided_at: string | null;
  decided_note: string | null;
  org_id: string | null;
};

const STATUS_LABEL: Record<Application["status"], { label: string; cls: string }> = {
  pending: { label: "未対応", cls: "bg-amber-100 text-amber-700" },
  reviewing: { label: "審査中", cls: "bg-blue-100 text-blue-700" },
  approved: { label: "承認済み", cls: "bg-emerald-100 text-emerald-700" },
  rejected: { label: "否認", cls: "bg-slate-200 text-slate-600" },
};

export default function ApplicationsPage() {
  const [apps, setApps] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  // 承認モーダル
  const [approveTarget, setApproveTarget] = useState<Application | null>(null);
  const [orgName, setOrgName] = useState("");
  const [orgCode, setOrgCode] = useState("");
  const [approveError, setApproveError] = useState("");
  // 発行結果（1回だけ表示）
  const [issued, setIssued] = useState<{ company: string; joinCode: string; inviteUrl: string } | null>(null);

  const load = useCallback(() => {
    apiFetch<{ applications: Application[] }>("/api/platform/applications")
      .then((d) => setApps(d.applications ?? []))
      .catch((e) => setError(e instanceof Error ? e.message : "取得に失敗しました"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (id: string, body: Record<string, unknown>) => {
    setBusyId(id);
    try {
      const res = await apiFetch<{ ok: boolean; joinCode?: string; adminInviteToken?: string }>(
        `/api/platform/applications/${id}`,
        { method: "PATCH", body: JSON.stringify(body) },
      );
      load();
      return res;
    } finally {
      setBusyId(null);
    }
  };

  const approve = async () => {
    if (!approveTarget) return;
    setApproveError("");
    try {
      const res = await act(approveTarget.id, { action: "approve", orgName, orgCode });
      if (res.joinCode && res.adminInviteToken) {
        setIssued({
          company: orgName,
          joinCode: res.joinCode,
          inviteUrl: `${window.location.origin}/join?invite=${res.adminInviteToken}`,
        });
      }
      setApproveTarget(null);
    } catch (e) {
      setApproveError(e instanceof Error ? e.message : "承認に失敗しました");
    }
  };

  if (loading) return <p className="text-slate-500 py-10 text-center">読み込み中...</p>;
  if (error) return <p className="text-red-600 py-10 text-center">{error}</p>;

  return (
    <div className="space-y-4">
      <h1 className="font-bold text-slate-900">オンボーディング申請</h1>

      {issued && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 space-y-2">
          <p className="font-semibold text-emerald-800">{issued.company} を発行しました</p>
          <p className="text-sm text-emerald-800">
            参加コード: <span className="font-mono font-bold">{issued.joinCode}</span>
          </p>
          <p className="text-sm text-emerald-800 break-all">
            初代管理者の招待リンク（14日有効・この画面にのみ表示）: <span className="font-mono">{issued.inviteUrl}</span>
          </p>
          <button className="text-xs text-emerald-700 underline" onClick={() => setIssued(null)}>
            閉じる
          </button>
        </div>
      )}

      {apps.length === 0 ? (
        <div className="bg-white rounded-lg border border-slate-200 p-8 text-center text-slate-400">
          申請はまだありません（受付フォーム: /apply）
        </div>
      ) : (
        <div className="space-y-3">
          {apps.map((a) => {
            const st = STATUS_LABEL[a.status];
            const busy = busyId === a.id;
            return (
              <div key={a.id} className="bg-white rounded-lg border border-slate-200 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-900">{a.company_name}</span>
                      <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${st.cls}`}>{st.label}</span>
                    </div>
                    <div className="text-xs text-slate-500 mt-1 space-x-3">
                      {a.corporate_number && <span>法人番号 {a.corporate_number}</span>}
                      {a.representative && <span>代表 {a.representative}</span>}
                      <span>
                        連絡先 {a.contact_name ? `${a.contact_name}・` : ""}
                        {a.contact_email}
                        {a.contact_phone ? `・${a.contact_phone}` : ""}
                      </span>
                    </div>
                    {a.address && <div className="text-xs text-slate-500 mt-0.5">{a.address}</div>}
                    {a.message && <p className="text-sm text-slate-700 mt-2 whitespace-pre-wrap">{a.message}</p>}
                    {a.decided_note && <p className="text-xs text-slate-400 mt-1">審査メモ: {a.decided_note}</p>}
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[11px] text-slate-400">{new Date(a.created_at).toLocaleString("ja-JP")}</div>
                    {(a.status === "pending" || a.status === "reviewing") && (
                      <div className="flex gap-2 mt-2 justify-end">
                        {a.status === "pending" && (
                          <button
                            className="text-xs px-3 py-1.5 rounded-md border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                            disabled={busy}
                            onClick={() => act(a.id, { action: "reviewing" }).catch(() => {})}
                          >
                            審査中にする
                          </button>
                        )}
                        <button
                          className="text-xs px-3 py-1.5 rounded-md border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50"
                          disabled={busy}
                          onClick={() => {
                            const note = window.prompt("否認理由（任意・申請台帳に残ります）") ?? undefined;
                            act(a.id, { action: "reject", decidedNote: note }).catch(() => {});
                          }}
                        >
                          否認
                        </button>
                        <button
                          className="text-xs px-3 py-1.5 rounded-md bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-50"
                          disabled={busy}
                          onClick={() => {
                            setApproveTarget(a);
                            setOrgName(a.company_name);
                            setOrgCode("");
                            setApproveError("");
                          }}
                        >
                          承認して発行
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 承認モーダル */}
      {approveTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={() => setApproveTarget(null)}>
          <div className="bg-white rounded-xl p-5 w-full max-w-md space-y-3" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-bold text-slate-900">組織を発行する</h2>
            <p className="text-xs text-slate-500">
              導入相談・KYB 確認が済んでいることを前提に、organizations と既定ロール・初代管理者の招待リンクを発行します。
            </p>
            <label className="block text-sm">
              <span className="text-slate-600">組織名</span>
              <input
                className="mt-1 w-full border border-slate-300 rounded-md px-3 py-2"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">会社コード（英数2〜10文字・例: ACE）</span>
              <input
                className="mt-1 w-full border border-slate-300 rounded-md px-3 py-2 font-mono uppercase"
                value={orgCode}
                onChange={(e) => setOrgCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10))}
              />
            </label>
            {approveError && <p className="text-sm text-red-600">{approveError}</p>}
            <div className="flex gap-2 justify-end pt-1">
              <button className="px-4 py-2 rounded-md border border-slate-300 text-slate-600 text-sm" onClick={() => setApproveTarget(null)}>
                キャンセル
              </button>
              <button
                className="px-4 py-2 rounded-md bg-slate-900 text-white text-sm disabled:opacity-50"
                disabled={!orgName.trim() || !orgCode.trim() || busyId === approveTarget.id}
                onClick={approve}
              >
                発行する
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
