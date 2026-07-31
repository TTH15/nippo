"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";

// プラットフォームダッシュボード（Phase 1・集計のみ / PII なし）。
// org ごとの利用状況を件数で俯瞰する。個社データへのドリルダウンは意図的に作らない。

type OrgMetric = {
  id: string;
  code: string;
  name: string;
  joinCode: string | null;
  status: string;
  createdAt: string;
  activeDrivers: number;
  kycVerifiedDrivers: number;
  reportsThisMonth: number;
  workSessionsThisMonth: number;
  notificationsThisMonth: number;
  lineSentThisMonth: number;
  lastReportDate: string | null;
};

const STATUS_BADGE: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-700",
  pending: "bg-amber-100 text-amber-700",
  suspended: "bg-red-100 text-red-700",
};

export default function PlatformDashboard() {
  const [orgs, setOrgs] = useState<OrgMetric[]>([]);
  const [pendingApps, setPendingApps] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      apiFetch<{ orgs: OrgMetric[] }>("/api/platform/orgs"),
      apiFetch<{ applications: { status: string }[] }>("/api/platform/applications").catch(() => ({ applications: [] })),
    ])
      .then(([o, a]) => {
        setOrgs(o.orgs ?? []);
        setPendingApps((a.applications ?? []).filter((x) => x.status === "pending" || x.status === "reviewing").length);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "取得に失敗しました"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-slate-500 py-10 text-center">読み込み中...</p>;
  if (error) {
    return (
      <div className="bg-white rounded-lg border border-slate-200 p-6 text-center">
        <p className="text-red-600">{error}</p>
        <p className="text-slate-500 text-sm mt-2">プラットフォーム運営者のアカウントでログインしているか確認してください。</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {pendingApps > 0 && (
        <Link
          href="/platform/applications"
          className="block bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-amber-800 text-sm hover:bg-amber-100"
        >
          審査待ちの申請が {pendingApps} 件あります →
        </Link>
      )}

      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <h1 className="font-bold text-slate-900">組織一覧</h1>
          <span className="text-xs text-slate-400">今月 = 当月1日から現在まで</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
                <th className="px-4 py-2 font-medium">組織</th>
                <th className="px-3 py-2 font-medium">状態</th>
                <th className="px-3 py-2 font-medium text-right">在籍(承認済)</th>
                <th className="px-3 py-2 font-medium text-right">日報/月</th>
                <th className="px-3 py-2 font-medium text-right">稼働/月</th>
                <th className="px-3 py-2 font-medium text-right">通知/月</th>
                <th className="px-3 py-2 font-medium text-right">LINE通数/月</th>
                <th className="px-3 py-2 font-medium">最終日報</th>
                <th className="px-3 py-2 font-medium">参加コード</th>
              </tr>
            </thead>
            <tbody>
              {orgs.map((o) => (
                <tr key={o.id} className="border-b border-slate-50 last:border-0">
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-slate-900">{o.name}</div>
                    <div className="text-[11px] text-slate-400">{o.code}</div>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[o.status] ?? "bg-slate-100 text-slate-600"}`}>
                      {o.status}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {o.activeDrivers}
                    <span className="text-slate-400 text-xs">（{o.kycVerifiedDrivers}）</span>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{o.reportsThisMonth}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{o.workSessionsThisMonth}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{o.notificationsThisMonth}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{o.lineSentThisMonth}</td>
                  <td className="px-3 py-2.5 text-slate-600">{o.lastReportDate ?? "—"}</td>
                  <td className="px-3 py-2.5 font-mono text-slate-600">{o.joinCode ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-slate-400">
        このコンソールは集計値のみを表示します（個社の明細・個人情報は表示しない設計）。
      </p>
    </div>
  );
}
