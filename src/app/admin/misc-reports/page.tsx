"use client";

import Link from "next/link";
import { AdminLayout } from "@/lib/components/AdminLayout";

export default function AdminMiscReportsPage() {
  return (
    <AdminLayout>
      <div className="max-w-3xl">
        <h1 className="text-xl font-bold text-slate-900 mb-6">諸報告</h1>
        <div className="grid gap-4 sm:grid-cols-2">
          <Link
            href="/admin/daily"
            className="block rounded-lg border border-slate-200 bg-white p-5 hover:border-slate-300 hover:shadow-sm transition"
          >
            <h2 className="text-base font-bold text-slate-900">日報報告</h2>
            <p className="text-sm text-slate-500 mt-2">日々の配送日報の承認・却下を行います。</p>
          </Link>
          <Link
            href="/admin/misc-reports/others"
            className="block rounded-lg border border-slate-200 bg-white p-5 hover:border-slate-300 hover:shadow-sm transition"
          >
            <h2 className="text-base font-bold text-slate-900">その他の報告</h2>
            <p className="text-sm text-slate-500 mt-2">オイル交換・修理・単発案件などの諸報告の承認・却下を行います。</p>
          </Link>
        </div>
      </div>
    </AdminLayout>
  );
}
