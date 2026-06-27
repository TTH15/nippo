"use client";

import { useParams } from "next/navigation";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { useApi } from "@/lib/useApi";
import { InvoiceDocument } from "../../_components/InvoiceDocument";
import { toInvoiceDocData } from "../../_components/invoiceAdapter";

type InvoiceResp = {
  invoice: {
    id: string;
    invoiceNo?: string;
    clientName?: string;
    payload?: unknown;
  };
};

export default function AdminInvoicePreviewPage() {
  const params = useParams<{ id: string }>();
  const id = String(params?.id ?? "");
  const { data, isInitialLoading, error } = useApi<InvoiceResp>(
    id ? `/api/admin/invoices/${encodeURIComponent(id)}` : null,
  );
  // 旧 iframe プレビュー（PDF/印刷は当面こちら。React 版の PDF 化が済んだら撤去）。
  const legacySrc = `/invoice/index.html?invoiceId=${encodeURIComponent(id)}&readonly=1`;

  return (
    <AdminLayout>
      <div className="-m-6">
        <div className="px-6 py-3 bg-white border-b border-slate-200 flex items-center justify-between">
          <a
            href="/admin/invoices"
            className="text-sm text-slate-600 underline hover:text-slate-900"
          >
            一覧へ戻る
          </a>
          <a
            href={legacySrc}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-slate-500 underline hover:text-slate-900"
          >
            旧プレビュー（PDF/印刷）
          </a>
        </div>

        {isInitialLoading ? (
          <div className="p-10 text-center text-slate-500">読み込み中…</div>
        ) : error || !data?.invoice ? (
          <div className="p-10 text-center text-red-600">
            請求書を読み込めませんでした。
          </div>
        ) : (
          <InvoiceDocument data={toInvoiceDocData(data.invoice)} />
        )}
      </div>
    </AdminLayout>
  );
}
