"use client";

import { AdminLayout } from "@/lib/components/AdminLayout";
import { useEffect, useState } from "react";
import { getStoredDriver } from "@/lib/api";
import { canAdminWrite } from "@/lib/authz";

export default function InvoiceNewPage() {
  const [canWrite, setCanWrite] = useState(false);

  useEffect(() => {
    setCanWrite(canAdminWrite(getStoredDriver()?.role));
  }, []);

  if (!canWrite) {
    return (
      <AdminLayout>
        <div className="bg-white border border-slate-200 rounded-lg p-6">
          <p className="text-sm text-slate-700">
            閲覧専用アカウントでは利用できません。
          </p>
          <a
            href="/admin/invoices"
            className="inline-block mt-4 text-sm text-slate-700 underline hover:text-slate-900"
          >
            請求書一覧へ戻る
          </a>
        </div>
      </AdminLayout>
    );
  }

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
