"use client";

import { useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faImage, faTriangleExclamation, faCircleCheck } from "@fortawesome/free-solid-svg-icons";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { Skeleton } from "@/lib/components/Skeleton";
import { EditorModal } from "@/lib/components/EditorModal";
import { DatePicker } from "@/lib/components/DatePicker";
import { CustomSelect } from "@/lib/components/CustomSelect";
import { apiFetch } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { dateToReportDateStr, reportDateStrToDate, todayJST } from "@/lib/date";
import type { ReviewValue } from "@/server/reports/sourceImageReview";

// ============================================================
// 提出された原本画像と、読み取り・本人の確認を突き合わせて見る。
// 設計: docs/design/report-image-evidence-2026-09.md（RIMG-4）
//
// 読み取っただけの値と、本人が確認して日報へ入った値を分けて出す。
// 原本は一覧に載せず、開いたときだけ短時間URLで取りに行く。
// ============================================================

type Row = {
  id: string;
  reportDate: string;
  driverName: string;
  courseName: string | null;
  status: string;
  receivedAt: string;
  capturedAt: string | null;
  capturedAtSource: string;
  byteSize: number;
  originalFilename: string | null;
  templateName: string | null;
  templateVersion: string | null;
  adopted: boolean;
  confirmedAt: string | null;
  readingCount: number;
  values: ReviewValue[];
  duplicate: string;
  reasons: string[];
};

const STATUS_LABEL: Record<string, string> = {
  received: "原本のみ",
  reading: "読み取り中",
  needs_review: "確定待ち",
  confirmed: "確定",
  unsupported: "手入力",
  failed: "読み取り失敗",
};

const STATUS_OPTIONS = [
  { value: "all", label: "すべての状態" },
  { value: "needs_review", label: "確定待ち" },
  { value: "confirmed", label: "確定" },
  { value: "received", label: "原本のみ" },
  { value: "unsupported", label: "手入力" },
];

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

/** 人が読む日付。ハイフン表記は出さない */
function formatDay(value: string): string {
  const date = new Date(`${value}T00:00:00+09:00`);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getMonth() + 1}月${date.getDate()}日（${WEEKDAYS[date.getDay()]}）`;
}

function formatTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const shiftDays = (date: string, days: number): string => {
  const time = Date.parse(`${date}T00:00:00Z`);
  return new Date(time + days * 86_400_000).toISOString().slice(0, 10);
};

export default function ReportImagesPage() {
  const today = todayJST();
  const [to, setTo] = useState(today);
  const [from, setFrom] = useState(() => shiftDays(today, -6));
  const [status, setStatus] = useState("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);

  const { data, isInitialLoading } = useApi<{ images: Row[]; unavailable?: boolean }>(
    `/api/admin/report-source-images?from=${from}&to=${to}&status=${status}`,
  );
  const rows = useMemo(() => data?.images ?? [], [data]);
  const open = useMemo(() => rows.find((row) => row.id === openId) ?? null, [rows, openId]);
  const needsReview = rows.filter((row) => row.reasons.length > 0).length;

  const openDetail = async (row: Row) => {
    setOpenId(row.id);
    setImageUrl(null);
    setImageError(null);
    try {
      const response = await apiFetch<{ url: string | null }>(`/api/admin/report-source-images/file?id=${row.id}`);
      setImageUrl(response.url);
    } catch {
      setImageError("原本を表示できませんでした");
    }
  };

  return (
    <AdminLayout>
      <div className="mx-auto max-w-5xl px-4 py-6">
        <h1 className="mb-3 flex items-center gap-2 text-xl font-bold text-slate-900">
          <FontAwesomeIcon icon={faImage} className="h-5 w-5 text-slate-400" />
          画像の確認
        </h1>

        {data?.unavailable && (
          <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
            <FontAwesomeIcon icon={faTriangleExclamation} className="mr-2 h-3.5 w-3.5" />
            原本の保存先がまだ用意できていません（migration 169・181）
          </p>
        )}

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <DatePicker
            value={reportDateStrToDate(from)}
            onChange={(date) => date && setFrom(dateToReportDateStr(date))}
            ariaLabel="期間の開始日"
            className="h-10 w-44"
          />
          <span className="text-sm text-slate-400">〜</span>
          <DatePicker
            value={reportDateStrToDate(to)}
            onChange={(date) => date && setTo(dateToReportDateStr(date))}
            ariaLabel="期間の終了日"
            className="h-10 w-44"
          />
          <div className="w-44">
            <CustomSelect
              value={status}
              onChange={setStatus}
              options={STATUS_OPTIONS}
              ariaLabel="状態で絞る"
              size="sm"
              clearable={false}
            />
          </div>
          {needsReview > 0 && (
            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">
              確認 {needsReview}件
            </span>
          )}
        </div>

        {isInitialLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : rows.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-200 py-16 text-center text-sm text-slate-400">
            この期間の提出はありません
          </p>
        ) : (
          <ul className="space-y-2">
            {rows.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => void openDetail(row)}
                  className="w-full rounded-lg border border-slate-200 bg-white p-3 text-left hover:border-slate-300"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-slate-900">{row.driverName}</span>
                    <span className="text-xs text-slate-500">{formatDay(row.reportDate)}</span>
                    {row.courseName && <span className="text-xs text-slate-400">{row.courseName}</span>}
                    <span
                      className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                        row.status === "confirmed" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {STATUS_LABEL[row.status] ?? row.status}
                    </span>
                    {row.templateName && <span className="text-[11px] text-slate-400">{row.templateName}</span>}
                  </div>

                  {row.values.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-700">
                      {row.values.map((value) => (
                        <span key={value.fieldId} className="tabular-nums">
                          {value.label ?? value.fieldId}
                          <span className="ml-1 font-medium">
                            {(value.confirmed ?? value.read) ?? "—"}
                          </span>
                          {value.corrected && <span className="ml-1 text-amber-700">（読取 {value.read ?? "—"}）</span>}
                        </span>
                      ))}
                    </div>
                  )}

                  {row.reasons.length > 0 && (
                    <p className="mt-1.5 text-[11px] text-amber-700">
                      <FontAwesomeIcon icon={faTriangleExclamation} className="mr-1 h-3 w-3" />
                      {row.reasons.join(" / ")}
                    </p>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {open && (
        <EditorModal title={`${open.driverName}・${formatDay(open.reportDate)}`} onClose={() => setOpenId(null)}>
          <div className="space-y-4">
            {imageError ? (
              <p className="rounded-lg bg-red-50 p-3 text-xs text-red-700">{imageError}</p>
            ) : imageUrl ? (
              <img src={imageUrl} alt="提出された原本" className="w-full rounded-lg border border-slate-200" />
            ) : (
              <Skeleton className="h-48 w-full" />
            )}

            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <dt className="text-slate-500">状態</dt>
              <dd className="text-slate-800">
                {STATUS_LABEL[open.status] ?? open.status}
                {open.adopted && <span className="ml-1 text-emerald-700">・日報へ反映</span>}
              </dd>
              <dt className="text-slate-500">受け取り</dt>
              <dd className="text-slate-800">{formatTime(open.receivedAt)}</dd>
              <dt className="text-slate-500">画像の作成日時</dt>
              <dd className="text-slate-800">
                {open.capturedAtSource === "unknown" ? "不明" : formatTime(open.capturedAt)}
              </dd>
              <dt className="text-slate-500">確認</dt>
              <dd className="text-slate-800">{formatTime(open.confirmedAt)}</dd>
              <dt className="text-slate-500">様式</dt>
              <dd className="text-slate-800">
                {open.templateName ? `${open.templateName}（第${open.templateVersion}版）` : "—"}
              </dd>
              <dt className="text-slate-500">読み取りの記録</dt>
              <dd className="text-slate-800">{open.readingCount}件</dd>
            </dl>

            {open.values.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-slate-500">
                      <th className="py-1.5 font-medium">項目</th>
                      <th className="py-1.5 text-right font-medium">読み取り</th>
                      <th className="py-1.5 text-right font-medium">確認後</th>
                    </tr>
                  </thead>
                  <tbody>
                    {open.values.map((value) => (
                      <tr key={value.fieldId} className="border-b border-slate-100">
                        <td className="py-1.5 text-slate-700">{value.label ?? value.fieldId}</td>
                        <td className="py-1.5 text-right tabular-nums text-slate-600">
                          {value.read ?? "—"}
                          {value.confidence != null && (
                            <span className="ml-1 text-[10px] text-slate-400">{Math.round(value.confidence * 100)}%</span>
                          )}
                        </td>
                        <td
                          className={`py-1.5 text-right tabular-nums ${value.corrected ? "font-medium text-amber-700" : "text-slate-800"}`}
                        >
                          {value.confirmed ?? "—"}
                          {!value.corrected && value.confirmed != null && (
                            <FontAwesomeIcon icon={faCircleCheck} className="ml-1 h-3 w-3 text-emerald-600" />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {open.reasons.length > 0 && (
              <ul className="space-y-1 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
                {open.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            )}
          </div>
        </EditorModal>
      )}
    </AdminLayout>
  );
}
