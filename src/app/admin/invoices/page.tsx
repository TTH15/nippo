"use client";

import { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus } from "@fortawesome/free-solid-svg-icons";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { getStoredDriver } from "@/lib/api";
import { canAdminWrite } from "@/lib/authz";

type SavedInvoice = {
  id: string;
  clientName: string;
  issueDate: string;
  amount: number;
  status: "draft" | "sent" | "paid";
};

const statusLabel: Record<SavedInvoice["status"], { text: string; cls: string }> = {
  draft: { text: "下書き", cls: "bg-slate-100 text-slate-600" },
  sent: { text: "送付済", cls: "bg-blue-50 text-blue-700" },
  paid: { text: "入金済", cls: "bg-emerald-50 text-emerald-700" },
};

const mockInvoices: SavedInvoice[] = [
  { id: "INV-2026-001", clientName: "ヤマト運輸株式会社", issueDate: "2026-02-01", amount: 1850000, status: "paid" },
  { id: "INV-2026-002", clientName: "Amazon配送サービス", issueDate: "2026-02-01", amount: 1230000, status: "sent" },
  { id: "INV-2026-003", clientName: "佐川急便株式会社", issueDate: "2026-02-15", amount: 920000, status: "draft" },
];

const fmt = (n: number) => `¥${n.toLocaleString("ja-JP")}`;

export default function InvoicesPage() {
  const [canWrite, setCanWrite] = useState(false);
  const [invoices] = useState<SavedInvoice[]>(mockInvoices);
  const [filter, setFilter] = useState<"all" | SavedInvoice["status"]>("all");

  const filtered = filter === "all" ? invoices : invoices.filter((inv) => inv.status === filter);
  
  useEffect(() => {
    setCanWrite(canAdminWrite(getStoredDriver()?.role));
  }, []);

  return (
    <AdminLayout>
      <div className="w-full">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-slate-900">請求書一覧</h1>
            <p className="text-sm text-slate-500 mt-0.5">登録済みの請求データから請求書を作成・管理</p>
          </div>
          {canWrite && (
            <a
              href="/admin/invoices/new"
              className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 text-white text-sm font-medium rounded hover:bg-slate-700 transition-colors"
            >
              <FontAwesomeIcon icon={faPlus} className="w-3.5 h-3.5" />
              新規作成
            </a>
          )}
        </div>

        {/* フィルター */}
        <div className="flex gap-1 mb-4">
          {([
            { key: "all", label: "すべて" },
            { key: "draft", label: "下書き" },
            { key: "sent", label: "送付済" },
            { key: "paid", label: "入金済" },
          ] as const).map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                filter === f.key
                  ? "bg-slate-800 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* テーブル */}
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="text-left px-4 py-3 font-medium text-slate-600">請求書番号</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">請求先</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">発行日</th>
                <th className="text-right px-4 py-3 font-medium text-slate-600">金額</th>
                <th className="text-center px-4 py-3 font-medium text-slate-600">ステータス</th>
                <th className="text-right px-4 py-3 font-medium text-slate-600"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                    該当する請求書はありません
                  </td>
                </tr>
              ) : (
                filtered.map((inv) => {
                  const s = statusLabel[inv.status];
                  return (
                    <tr key={inv.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 font-mono text-slate-700">{inv.id}</td>
                      <td className="px-4 py-3 text-slate-900 font-medium">{inv.clientName}</td>
                      <td className="px-4 py-3 text-slate-600">{inv.issueDate}</td>
                      <td className="px-4 py-3 text-right font-medium text-slate-900">{fmt(inv.amount)}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${s.cls}`}>
                          {s.text}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {canWrite && (
                          <button className="text-xs text-slate-500 hover:text-slate-800 transition-colors">
                            編集
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* サマリー */}
        <div className="grid grid-cols-3 gap-4 mt-6">
          <div className="bg-white rounded-lg border border-slate-200 p-4">
            <div className="text-xs text-slate-500 mb-1">下書き</div>
            <div className="text-lg font-bold text-slate-700">
              {invoices.filter((i) => i.status === "draft").length}件
            </div>
          </div>
          <div className="bg-white rounded-lg border border-slate-200 p-4">
            <div className="text-xs text-slate-500 mb-1">送付済（未入金）</div>
            <div className="text-lg font-bold text-blue-600">
              {fmt(invoices.filter((i) => i.status === "sent").reduce((s, i) => s + i.amount, 0))}
            </div>
          </div>
          <div className="bg-white rounded-lg border border-slate-200 p-4">
            <div className="text-xs text-slate-500 mb-1">今月入金済</div>
            <div className="text-lg font-bold text-emerald-600">
              {fmt(invoices.filter((i) => i.status === "paid").reduce((s, i) => s + i.amount, 0))}
            </div>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
