"use client";

import { useParams } from "next/navigation";
import { useRef, useState } from "react";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { Button } from "@/lib/ui/button";
import { useApi } from "@/lib/useApi";
import { InvoiceSheet } from "../../_components/InvoiceSheet";
import {
  editorFromInvoice,
  applyCounterparty,
  type CounterpartyAddress,
} from "../../_components/editorModel";
import { exportInvoicePdf, invoicePdfFileName } from "@/lib/invoicePdf";

type InvoiceResp = {
  invoice: {
    id: string;
    invoiceNo?: string;
    clientName?: string;
    section?: string;
    status?: "draft" | "pending_approval" | "approved" | "paid";
    counterpartyInvoiceAddressId?: string | null;
    direction?: "outgoing" | "incoming";
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
  const { data: addrData } = useApi<AddressesResp>("/api/admin/invoice-addresses");
  const counterparty = data?.invoice?.counterpartyInvoiceAddressId
    ? addrData?.addresses?.find((a) => a.id === data.invoice.counterpartyInvoiceAddressId)
    : undefined;

  const state = data?.invoice
    ? applyCounterparty(editorFromInvoice(data.invoice), counterparty)
    : null;

  const downloadPdf = async () => {
    if (!sheetRef.current || !state) return;
    setPdfBusy(true);
    try {
      await exportInvoicePdf(sheetRef.current, invoicePdfFileName(state.period, state.fromName));
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <AdminLayout>
      <div className="-m-6">
        <div className="px-6 py-3 bg-white border-b border-slate-200 flex items-center justify-between">
          <a href="/admin/invoices" className="text-sm text-slate-600 underline hover:text-slate-900">一覧へ戻る</a>
          <div className="flex items-center gap-2">
            <a href={`/admin/invoices/${encodeURIComponent(id)}/edit`} className="text-sm text-slate-600 underline hover:text-slate-900 mr-1">編集</a>
            <Button variant="outline" size="sm" onClick={() => window.print()} disabled={!state}>
              印刷
            </Button>
            <Button variant="default" size="sm" onClick={downloadPdf} disabled={pdfBusy || !state}>
              {pdfBusy ? "PDF生成中…" : "PDFダウンロード"}
            </Button>
          </div>
        </div>

        {isInitialLoading ? (
          <div className="p-10 text-center text-slate-500">読み込み中…</div>
        ) : error || !state ? (
          <div className="p-10 text-center text-red-600">請求書を読み込めませんでした。</div>
        ) : (
          <InvoiceSheet state={state} readOnly sheetRef={sheetRef} />
        )}
      </div>
    </AdminLayout>
  );
}
