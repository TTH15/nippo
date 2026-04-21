"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { apiFetch } from "@/lib/api";

type InvoiceDetail = {
  id: string;
  issueDate: string;
  amount: number;
  status: "draft" | "pending_approval" | "approved" | "paid";
  invoiceNo?: string;
  payload: any;
};

function statusLabel(status: InvoiceDetail["status"]): string {
  if (status === "draft") return "下書き";
  if (status === "pending_approval") return "承認待ち";
  if (status === "approved") return "承認済";
  return "入金済";
}

export default function AdminInvoicePreviewPage() {
  const params = useParams<{ id: string }>();
  const id = String(params?.id ?? "");
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setError(null);
    apiFetch<{ invoice: InvoiceDetail }>(`/api/admin/invoices/${encodeURIComponent(id)}`)
      .then((res) => setInvoice(res.invoice ?? null))
      .catch((e) => {
        console.error(e);
        setError("請求書の読み込みに失敗しました。");
      })
      .finally(() => setLoading(false));
  }, [id]);

  return (
    <AdminLayout>
      <div className="max-w-3xl mx-auto py-4">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-lg font-semibold text-slate-900">請求書プレビュー（編集不可）</h1>
          <a
            href="/admin/invoices"
            className="text-sm text-slate-600 underline hover:text-slate-900"
          >
            一覧へ戻る
          </a>
        </div>

        {loading ? (
          <div className="bg-white rounded-lg border border-slate-200 p-4 text-sm text-slate-500">読み込み中...</div>
        ) : error ? (
          <div className="bg-white rounded-lg border border-rose-200 p-4 text-sm text-rose-700">{error}</div>
        ) : !invoice ? (
          <div className="bg-white rounded-lg border border-slate-200 p-4 text-sm text-slate-500">請求書が見つかりません。</div>
        ) : (
          <div className="bg-white rounded-lg border border-slate-200 p-5 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-base font-semibold text-slate-900">{invoice?.payload?.fromName || "請求元"}</div>
                <div
                  className="mt-1 text-xs text-slate-600"
                  dangerouslySetInnerHTML={{ __html: invoice?.payload?.fromAddr || "" }}
                />
              </div>
              <div className="text-right text-xs text-slate-600 space-y-1">
                <div>ステータス: {statusLabel(invoice.status)}</div>
                <div>請求日: {invoice?.payload?.issueDate || invoice.issueDate || "-"}</div>
                <div>請求書番号: {invoice.invoiceNo || "-"}</div>
              </div>
            </div>

            <div className="text-xl font-bold text-slate-900">
              請求額 {Number(invoice.amount || 0).toLocaleString("ja-JP")}円
            </div>

            <div className="rounded-md border border-slate-200 divide-y divide-slate-100">
              <div className="px-3 py-2 text-xs font-semibold text-slate-600 bg-slate-50">摘要（売上）</div>
              {(invoice?.payload?.tableData?.main ?? []).length > 0 ? (
                (invoice?.payload?.tableData?.main ?? []).map((l: any, i: number) => (
                  <div key={`m-${i}`} className="px-3 py-2 flex justify-between text-sm">
                    <span>{l?.title || "明細"}</span>
                    <span className="tabular-nums">
                      {Number(l?.qty || 0).toLocaleString("ja-JP")} x {Number(l?.price || 0).toLocaleString("ja-JP")}円
                    </span>
                  </div>
                ))
              ) : (
                <div className="px-3 py-2 text-sm text-slate-500">売上明細がありません</div>
              )}
            </div>

            <div className="rounded-md border border-slate-200 divide-y divide-slate-100">
              <div className="px-3 py-2 text-xs font-semibold text-slate-600 bg-slate-50">控除</div>
              {(invoice?.payload?.tableData?.deduct ?? []).length > 0 ? (
                (invoice?.payload?.tableData?.deduct ?? []).map((l: any, i: number) => (
                  <div key={`d-${i}`} className="px-3 py-2 flex justify-between text-sm">
                    <span>{l?.title || "控除"}</span>
                    <span className="tabular-nums">
                      {Number(l?.qty || 0).toLocaleString("ja-JP")} x {Number(l?.price || 0).toLocaleString("ja-JP")}円
                    </span>
                  </div>
                ))
              ) : (
                <div className="px-3 py-2 text-sm text-slate-500">控除明細はありません</div>
              )}
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}

