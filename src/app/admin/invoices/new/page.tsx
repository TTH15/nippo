"use client";

import { AdminLayout } from "@/lib/components/AdminLayout";

export default function InvoiceNewPage() {
  return (
    <AdminLayout>
      <div className="-m-6">
        <iframe
          src="/invoice/index.html"
          className="w-full border-0"
          style={{ height: "calc(100vh - 0px)" }}
          title="請求書作成"
        />
      </div>
    </AdminLayout>
  );
}
