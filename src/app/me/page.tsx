"use client";

import { useEffect, useState } from "react";
import { Nav } from "@/lib/components/Nav";
import { apiFetch } from "@/lib/api";

type Report = {
  id: string;
  report_date: string;
  takuhaibin_completed: number;
  takuhaibin_returned: number;
  nekopos_completed: number;
  nekopos_returned: number;
  submitted_at: string;
};

export default function MePage() {
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<{ reports: Report[] }>("/api/reports/me")
      .then((d) => setReports(d.reports))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <Nav />
      <div className="max-w-2xl mx-auto px-4 py-8">
        <h1 className="text-lg font-bold text-brand-900 mb-6">提出履歴</h1>

        {loading ? (
          <p className="text-sm text-slate-500">読み込み中...</p>
        ) : reports.length === 0 ? (
          <p className="text-sm text-slate-500">まだ提出がありません</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left">
                  <th className="py-3 pr-3 font-semibold text-slate-600">日付</th>
                  <th className="py-3 px-2 font-semibold text-slate-600 text-right">宅急便<br/><span className="text-xs font-normal">完了</span></th>
                  <th className="py-3 px-2 font-semibold text-slate-600 text-right">宅急便<br/><span className="text-xs font-normal">持戻</span></th>
                  <th className="py-3 px-2 font-semibold text-slate-600 text-right">ネコポス<br/><span className="text-xs font-normal">完了</span></th>
                  <th className="py-3 pl-2 font-semibold text-slate-600 text-right">ネコポス<br/><span className="text-xs font-normal">持戻</span></th>
                </tr>
              </thead>
              <tbody>
                {reports.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="py-3 pr-3 font-medium">{r.report_date}</td>
                    <td className="py-3 px-2 text-right tabular-nums">{r.takuhaibin_completed}</td>
                    <td className="py-3 px-2 text-right tabular-nums text-orange-600">{r.takuhaibin_returned}</td>
                    <td className="py-3 px-2 text-right tabular-nums">{r.nekopos_completed}</td>
                    <td className="py-3 pl-2 text-right tabular-nums text-orange-600">{r.nekopos_returned}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
