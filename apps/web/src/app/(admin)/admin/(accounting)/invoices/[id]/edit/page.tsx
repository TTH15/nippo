"use client";

import { useParams } from "next/navigation";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { useApi } from "@/lib/useApi";
import { InvoiceEditor } from "../../_components/InvoiceEditor";
import { editorFromInvoice } from "../../_components/editorModel";

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

export default function AdminInvoiceEditPage() {
  const params = useParams<{ id: string }>();
  const id = String(params?.id ?? "");
  const { data, isInitialLoading, error } = useApi<InvoiceResp>(
    id ? `/api/admin/invoices/${encodeURIComponent(id)}` : null,
  );

  return (
    <AdminLayout>
      <div className="-m-6">
        {isInitialLoading ? (
          <div className="p-10 text-center text-slate-500">読み込み中…</div>
        ) : error || !data?.invoice ? (
          <div className="p-10 text-center text-red-600">請求書を読み込めませんでした。</div>
        ) : (
          <InvoiceEditor mode="edit" initial={editorFromInvoice(data.invoice)} />
        )}
      </div>
    </AdminLayout>
  );
}
