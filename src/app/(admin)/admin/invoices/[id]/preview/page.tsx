"use client";

import { useParams } from "next/navigation";
import { AdminLayout } from "@/lib/components/AdminLayout";

export default function AdminInvoicePreviewPage() {
  const params = useParams<{ id: string }>();
  const id = String(params?.id ?? "");
  const iframeSrc = `/invoice/index.html?invoiceId=${encodeURIComponent(id)}&readonly=1`;

  return (
    <AdminLayout>
      <div className="-m-6">
        <div className="px-6 py-3 bg-white border-b border-slate-200">
          <a href="/admin/invoices" className="text-sm text-slate-600 underline hover:text-slate-900">
            一覧へ戻る
          </a>
        </div>
        <iframe
          src={iframeSrc}
          className="w-full border-0"
          style={{ height: "calc(100vh - 60px)" }}
          title="請求書プレビュー"
        />
      </div>
    </AdminLayout>
  );
}

