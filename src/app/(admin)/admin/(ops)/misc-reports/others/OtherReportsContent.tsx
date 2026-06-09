"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getDisplayName } from "@/lib/displayName";
import { canAdminWrite } from "@/lib/authz";
import { getStoredDriver } from "@/lib/api";
import { VehiclePlate } from "@/lib/components/VehiclePlate";
import useSWRInfinite from "swr/infinite";
import { getAnswerValue, formatAnswer } from "@/server/reportKinds/answers";
import type { ReportField } from "@/server/reportKinds/fields";

type MiscReport = {
  id: string;
  driver_id: string;
  report_date: string;
  report_time: string;
  location: string;
  report_kind?: string;
  description?: string | null;
  odometer_km: number | null;
  expense_amount?: number | null;
  answers?: Record<string, unknown> | null;
  attachments?: { fieldId: string; path: string; name: string; mime: string; size: number; url?: string | null }[] | null;
  submitted_at: string;
  approved_at: string | null;
  rejected_at: string | null;
  vehicles?: {
    id: string;
    number_prefix?: string | null;
    number_class?: string | null;
    number_hiragana?: string | null;
    number_numeric?: string | null;
    manufacturer?: string | null;
    brand?: string | null;
  } | null;
};

type Entry = {
  driver: { id: string; name: string; display_name: string | null };
  report: MiscReport;
};
type OilChangePage = { entries: Entry[]; nextCursor: string | null; hasMore: boolean };
const PAGE_SIZE = 30;

type ReportKindInfo = { key: string; label: string; fields: ReportField[] };

/** 「M/D HH:MM」形式。日付が異なる承認も追えるよう日付を含める。 */
function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** 報告の動的フィールドを「ラベル: 値」で描画。file 型は添付（署名URL）リンクで表示。 */
function ReportAnswers({ report, fields }: { report: MiscReport; fields: ReportField[] }) {
  const atts = report.attachments ?? [];
  type AnsRow =
    | { f: ReportField; text: string; files?: undefined }
    | { f: ReportField; files: NonNullable<MiscReport["attachments"]>; text?: undefined };
  const rows = fields
    .map((f): AnsRow | null => {
      if (f.type === "file") {
        const mine = atts.filter((a) => a.fieldId === f.id);
        return mine.length ? { f, files: mine } : null;
      }
      const text = formatAnswer(f, getAnswerValue(report, f));
      return text && text !== "—" ? { f, text } : null;
    })
    .filter((r): r is AnsRow => r !== null);
  if (rows.length === 0) return <span className="text-slate-400">—</span>;
  return (
    <div className="space-y-0.5">
      {rows.map((r) => (
        <div key={r.f.id} className="text-[13px]">
          <span className="text-slate-400 text-xs mr-1.5">{r.f.label}</span>
          {r.files ? (
            <span className="inline-flex flex-wrap gap-2 align-top">
              {r.files.map((a) =>
                a.url ? (
                  <a key={a.path} href={a.url} target="_blank" rel="noopener noreferrer" className="text-sky-600 underline underline-offset-2">
                    {a.name}
                  </a>
                ) : (
                  <span key={a.path} className="text-slate-500">{a.name}</span>
                ),
              )}
            </span>
          ) : (
            <span className="text-slate-800 whitespace-pre-wrap break-words">{r.text}</span>
          )}
        </div>
      ))}
    </div>
  );
}

export function OtherReportsContent() {
  const [tab, setTab] = useState<"pending" | "approved">("pending");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const canWrite = canAdminWrite(getStoredDriver()?.role);

  // 報告種別マスタ（ラベル・使用フィールドの解決用）。
  const [kindByKey, setKindByKey] = useState<Map<string, ReportKindInfo>>(new Map());
  useEffect(() => {
    apiFetch<{ kinds: ReportKindInfo[] }>("/api/admin/report-kinds")
      .then((res) => setKindByKey(new Map((res.kinds ?? []).map((k) => [k.key, k]))))
      .catch(() => { });
  }, []);
  const kindLabel = (key: string | undefined) => (key ? kindByKey.get(key)?.label ?? key : "—");

  const getKey = (pageIndex: number, previousPageData: OilChangePage | null) => {
    if (previousPageData && !previousPageData.hasMore) return null;
    const cursor = previousPageData?.nextCursor ?? "0";
    return `/api/admin/misc-reports/oil-change?status=${tab}&limit=${PAGE_SIZE}&cursor=${cursor}`;
  };

  const {
    data: pages,
    isLoading,
    isValidating,
    setSize,
    mutate,
  } = useSWRInfinite<OilChangePage>(getKey, (url: string) => apiFetch<OilChangePage>(url), {
    revalidateOnFocus: false,
    dedupingInterval: 5 * 60 * 1000,
    revalidateFirstPage: false,
  });

  const entries = useMemo(() => (pages ?? []).flatMap((p) => p.entries ?? []), [pages]);
  const loading = isLoading && entries.length === 0;
  const hasMore = (pages?.[pages.length - 1]?.hasMore ?? false) && !isValidating;

  useEffect(() => {
    const node = loadMoreRef.current;
    if (!node) return;
    const observer = new IntersectionObserver((obsEntries) => {
      if (!obsEntries[0]?.isIntersecting) return;
      if (!hasMore) return;
      void setSize((s) => s + 1);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, setSize]);

  const handleAction = async (id: string, action: "approve" | "reject") => {
    try {
      await apiFetch(`/api/admin/misc-reports/oil-change/${action}`, {
        method: "POST",
        body: JSON.stringify({ id }),
      });
      await mutate((prev) => {
        if (!prev) return prev;
        return prev.map((page) => ({
          ...page,
          entries: page.entries.filter((e) => e.report.id !== id),
        }));
      }, { revalidate: false });
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "操作に失敗しました");
    }
  };

  return (
    <>
      <div className="w-full">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-bold text-slate-900">その他の報告</h1>
          <div className="flex rounded-lg bg-slate-100 p-0.5">
            <button
              type="button"
              onClick={() => setTab("pending")}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                tab === "pending" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-800"
              }`}
            >
              未承認
            </button>
            <button
              type="button"
              onClick={() => setTab("approved")}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                tab === "approved" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-800"
              }`}
            >
              承認履歴
            </button>
          </div>
        </div>

        {errorMessage && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800 mb-4">
            {errorMessage}
          </div>
        )}

        {loading ? (
          <div className="bg-white rounded-lg border border-slate-200 p-6 text-sm text-slate-500">読み込み中...</div>
        ) : entries.length === 0 ? (
          <div className="bg-white rounded-lg border border-slate-200 p-6 text-sm text-slate-500">
            {tab === "pending" ? "未承認のその他報告はありません。" : "承認済みのその他報告はありません。"}
          </div>
        ) : (
          <>
          {/* スマホ: カード表示 */}
          <div className="md:hidden space-y-2">
            {entries.map(({ driver, report }) => (
              <MiscReportCard
                key={`card-${report.id}`}
                driver={driver}
                report={report}
                kindLabel={kindLabel(report.report_kind)}
                fields={kindByKey.get(report.report_kind ?? "")?.fields ?? []}
                tab={tab}
                canWrite={canWrite}
                onApprove={() => handleAction(report.id, "approve")}
                onReject={() => handleAction(report.id, "reject")}
              />
            ))}
          </div>
          {/* PC: テーブル表示 */}
          <div className="hidden md:block bg-white rounded-lg border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[840px]">
                <thead className="bg-slate-50">
                  <tr className="border-b border-slate-200 text-left">
                    <th className="py-3 px-4 font-semibold text-slate-600">ドライバー</th>
                    <th className="py-3 px-3 font-semibold text-slate-600">種別</th>
                    <th className="py-3 px-3 font-semibold text-slate-600">日時</th>
                    <th className="py-3 px-3 font-semibold text-slate-600 text-center min-w-[160px]">車両</th>
                    <th className="py-3 px-3 font-semibold text-slate-600 min-w-[220px]">内容</th>
                    <th className="py-3 px-3 font-semibold text-slate-600 text-center">
                      {tab === "pending" ? "承認" : "ステータス"}
                    </th>
                    <th className="py-3 px-4 font-semibold text-slate-600 text-right whitespace-nowrap">
                      {tab === "approved" ? "送信 / 承認" : "送信日時"}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map(({ driver, report }) => {
                    return (
                    <tr key={report.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="py-3 px-4 font-medium align-top">{getDisplayName(driver)}</td>
                      <td className="py-3 px-3 text-sm align-top">{kindLabel(report.report_kind)}</td>
                      <td className="py-3 px-3 tabular-nums align-top">{report.report_date} {report.report_time}</td>
                      <td className="py-3 px-3 text-center align-top">
                        {report.vehicles ? (
                          <VehiclePlate vehicle={report.vehicles} compact className="max-w-[150px] mx-auto" />
                        ) : (
                          <span className="text-slate-400 text-xs">—</span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-slate-700 max-w-[320px] align-top">
                        <ReportAnswers report={report} fields={kindByKey.get(report.report_kind ?? "")?.fields ?? []} />
                      </td>
                      <td className="py-3 px-3 text-center align-top">
                        {tab === "approved" ? (
                          <span className="inline-flex items-center px-3 py-1 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-700">
                            承認済み
                          </span>
                        ) : canWrite ? (
                          <div className="flex items-center justify-center gap-2">
                            <button
                              type="button"
                              onClick={() => handleAction(report.id, "approve")}
                              className="inline-flex items-center px-4 py-1.5 rounded-full text-xs font-semibold bg-slate-800 text-white hover:bg-slate-700"
                            >
                              承認
                            </button>
                            <button
                              type="button"
                              onClick={() => handleAction(report.id, "reject")}
                              className="inline-flex items-center px-4 py-1.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200"
                            >
                              却下
                            </button>
                          </div>
                        ) : (
                          <span className="text-slate-400 text-xs">未承認</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right text-slate-500 tabular-nums whitespace-nowrap align-top">
                        <div>{fmtDateTime(report.submitted_at)}</div>
                        {tab === "approved" && report.approved_at && (
                          <div className="text-[11px] text-emerald-600">承認 {fmtDateTime(report.approved_at)}</div>
                        )}
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <div ref={loadMoreRef} className="h-6" />
          {hasMore && (
            <div className="py-2 text-center text-xs text-slate-500">さらに読み込み中...</div>
          )}
          </>
        )}
      </div>
    </>
  );
}

/** スマホ用カード（その他報告 1件）。 */
function MiscReportCard({
  driver,
  report,
  kindLabel,
  fields,
  tab,
  canWrite,
  onApprove,
  onReject,
}: {
  driver: { id: string; name: string; display_name: string | null };
  report: MiscReport;
  kindLabel: string;
  fields: ReportField[];
  tab: "pending" | "approved";
  canWrite: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-slate-900">{getDisplayName(driver)}</span>
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-600">
          {kindLabel}
        </span>
      </div>

      <div className="mt-1.5 text-xs text-slate-500 tabular-nums">
        {report.report_date} {report.report_time}
      </div>

      {report.vehicles && (
        <div className="mt-2">
          <VehiclePlate vehicle={report.vehicles} compact className="max-w-[150px]" />
        </div>
      )}

      <div className="mt-2">
        <ReportAnswers report={report} fields={fields} />
      </div>

      <div className="mt-2.5 flex items-center justify-between gap-2">
        <span className="text-[11px] text-slate-400 tabular-nums">
          送信 {fmtDateTime(report.submitted_at)}
          {tab === "approved" && report.approved_at && (
            <span className="text-emerald-600"> / 承認 {fmtDateTime(report.approved_at)}</span>
          )}
        </span>
        {tab === "approved" ? (
          <span className="inline-flex items-center px-3 py-1 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-700">
            承認済み
          </span>
        ) : canWrite ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onApprove}
              className="px-4 py-1.5 rounded-full text-[12px] font-semibold bg-slate-800 text-white hover:bg-slate-700"
            >
              承認
            </button>
            <button
              type="button"
              onClick={onReject}
              className="px-4 py-1.5 rounded-full text-[12px] font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200"
            >
              却下
            </button>
          </div>
        ) : (
          <span className="text-slate-400 text-xs">未承認</span>
        )}
      </div>
    </div>
  );
}
