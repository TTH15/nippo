"use client";

import { useParams } from "next/navigation";
import { useRef, useState } from "react";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { useApi } from "@/lib/useApi";
import { InvoiceDocument } from "../../_components/InvoiceDocument";
import { toInvoiceDocData, type CounterpartyAddress } from "../../_components/invoiceAdapter";
import { exportInvoicePdf, invoicePdfFileName } from "@/lib/invoicePdf";

type InvoiceResp = {
  invoice: {
    id: string;
    invoiceNo?: string;
    clientName?: string;
    counterpartyInvoiceAddressId?: string | null;
    payload?: unknown;
  };
};

type AddressesResp = { addresses: (CounterpartyAddress & { id: string })[] };

export default function AdminInvoicePreviewPage() {
  const params = useParams<{ id: string }>();
  const id = String(params?.id ?? "");
  const sheetRef = useRef<HTMLDivElement>(null);
  const [pdfBusy, setPdfBusy] = useState(false);

  const { data, isInitialLoading, error } = useApi<InvoiceResp>(
    id ? `/api/admin/invoices/${encodeURIComponent(id)}` : null,
  );
  // 請求先住所が payload に無い場合の補完用にアドレス帳を取得。
  const { data: addrData } = useApi<AddressesResp>("/api/admin/invoice-addresses");
  const counterparty = data?.invoice?.counterpartyInvoiceAddressId
    ? addrData?.addresses?.find((a) => a.id === data.invoice.counterpartyInvoiceAddressId)
    : undefined;

  const docData = data?.invoice ? toInvoiceDocData(data.invoice, counterparty) : null;

  const downloadPdf = async () => {
    if (!sheetRef.current || !docData) return;
    setPdfBusy(true);
    try {
      await exportInvoicePdf(
        sheetRef.current,
        invoicePdfFileName(docData.period, docData.fromName),
      );
    } finally {
      setPdfBusy(false);
    }
  };

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
          <div className="flex items-center gap-3">
            <a
              href={`/admin/invoices/${encodeURIComponent(id)}/edit`}
              className="text-sm text-slate-600 underline hover:text-slate-900"
            >
              編集
            </a>
            <button
              onClick={downloadPdf}
              disabled={pdfBusy || !docData}
              className="rounded-lg bg-slate-800 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
            >
              {pdfBusy ? "PDF生成中…" : "PDFダウンロード"}
            </button>
          </div>
        </div>

        {isInitialLoading ? (
          <div className="p-10 text-center text-slate-500">読み込み中…</div>
        ) : error || !docData ? (
          <div className="p-10 text-center text-red-600">
            請求書を読み込めませんでした。
          </div>
        ) : (
          <InvoiceDocument data={docData} sheetRef={sheetRef} />
        )}
      </div>
    </AdminLayout>
  );
}
