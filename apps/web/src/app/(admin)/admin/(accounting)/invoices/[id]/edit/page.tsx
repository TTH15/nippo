"use client";

import { useParams } from "next/navigation";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { useApi } from "@/lib/useApi";
import { InvoiceSheetEditor } from "../../_components/InvoiceSheetEditor";
import { editorFromInvoice } from "../../_components/editorModel";
import { DesktopOnlyNotice, useIsDesktop } from "../../_components/DesktopOnlyNotice";

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
  // 帳票エディタは A4 幅前提。狭い画面では新規作成と同様に案内へ差し替える
  const isDesktop = useIsDesktop();
  const { data, isInitialLoading, error } = useApi<InvoiceResp>(
    id ? `/api/admin/invoices/${encodeURIComponent(id)}` : null,
  );

  if (isDesktop === null) {
    return (
      <AdminLayout>
        <div className="h-40" />
      </AdminLayout>
    );
  }

  if (!isDesktop) {
    return (
      <AdminLayout>
        <DesktopOnlyNotice title="請求書の編集はPCでご利用ください" />
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="-mx-3 -my-4 md:-m-6">
        {isInitialLoading ? (
          <div className="p-10 text-center text-slate-500">読み込み中…</div>
        ) : error || !data?.invoice ? (
          <div className="p-10 text-center text-red-600">請求書を読み込めませんでした。</div>
        ) : (
          <InvoiceSheetEditor mode="edit" initial={editorFromInvoice(data.invoice)} />
        )}
      </div>
    </AdminLayout>
  );
}
