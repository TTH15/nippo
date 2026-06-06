"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faChevronDown,
  faChevronRight,
  faFileInvoice,
  faFloppyDisk,
} from "@fortawesome/free-solid-svg-icons";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { MonthYearPicker } from "@/lib/components/MonthYearPicker";
import { apiFetch, getStoredDriver } from "@/lib/api";
import { canAdminWrite } from "@/lib/authz";
import { CounterpartyBillingExpand } from "./CounterpartyBillingExpand";

type CourseRow = {
  id: string;
  name: string;
  carrier: "YAMATO" | "AMAZON" | "OTHER";
};

type CounterpartySummaryRow = {
  id: string;
  name: string;
  billingNotes: string;
  courseCount: number;
  courses: CourseRow[];
  systemRevenue: number;
  salesLogRevenueTotal: number;
  salesLogDeductionTotal: number;
  customMainTotal: number;
  customDeductionTotal: number;
  monthTotal: number;
  suggestedSection: "Amazon" | "ヤマト運輸" | "郵便局";
};

const fmt = (n: number) => `¥${n.toLocaleString("ja-JP")}`;

function monthStrFromYm(y: number, m: number) {
  return `${y}-${String(m).padStart(2, "0")}`;
}

export default function CounterpartiesPage() {
  const [canWrite, setCanWrite] = useState(false);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return monthStrFromYm(d.getFullYear(), d.getMonth() + 1);
  });
  const [ym, setYm] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  });
  const [rows, setRows] = useState<CounterpartySummaryRow[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [draftNotes, setDraftNotes] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [createInvoiceError, setCreateInvoiceError] = useState<string | null>(null);

  useEffect(() => {
    setCanWrite(canAdminWrite(getStoredDriver()?.role));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ month: string; rows: CounterpartySummaryRow[] }>(
        `/api/admin/counterparties/summary?month=${encodeURIComponent(month)}`
      );
      setRows(res.rows ?? []);
    } catch (e) {
      console.error(e);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveNotes = async (id: string) => {
    if (!canWrite) return;
    setSavingId(id);
    try {
      await apiFetch(`/api/admin/invoice-addresses/${id}`, {
        method: "PUT",
        body: JSON.stringify({ billingNotes: draftNotes[id] ?? "" }),
      });
      setRows((prev) =>
        prev.map((r) => (r.id === id ? { ...r, billingNotes: draftNotes[id] ?? "" } : r))
      );
    } catch (e) {
      console.error(e);
    } finally {
      setSavingId(null);
    }
  };

  const openRow = (r: CounterpartySummaryRow) => {
    setExpandedId((id) => (id === r.id ? null : r.id));
    setDraftNotes((d) => ({ ...d, [r.id]: r.billingNotes ?? "" }));
  };

  return (
    <AdminLayout>
      <div className="w-full max-w-6xl">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-xl font-bold text-slate-900">取引先</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              コース別の自動集計、売上ログ（単発案件など）、手入力の加算・控除をまとめて管理します。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <MonthYearPicker
              value={ym}
              onChange={(v) => {
                setYm(v);
                setMonth(monthStrFromYm(v.year, v.month));
              }}
              placeholder="対象月"
            />
            <Link
              href="/admin/invoices"
              className="text-sm text-slate-600 hover:text-slate-900 underline underline-offset-2"
            >
              請求書一覧
            </Link>
          </div>
        </div>

        <div className="rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs text-amber-900 mb-4">
          月次合計は「シフト集計＋売上ログ（取引先指定）＋手入力加算 −
          売上ログのマイナス利益 − 手入力控除」です。摘要は明細表でフォーカスアウト時に保存されます。郵便局帯の
          sales_log 会社集計とは定義が異なる場合があります。
        </div>
        {createInvoiceError && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 mb-4">
            {createInvoiceError}
          </div>
        )}

        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[800px] md:min-w-0">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="sticky left-0 z-20 bg-slate-50 text-left px-3 py-3 font-medium text-slate-600 w-10" />
                  <th className="sticky left-10 z-20 bg-slate-50 text-left px-3 py-3 font-medium text-slate-600">取引先（請求先）</th>
                  <th className="text-right px-3 py-3 font-medium text-slate-600">コース数</th>
                  <th className="text-right px-3 py-3 font-medium text-slate-600">月次純額</th>
                  <th className="text-left px-3 py-3 font-medium text-slate-600">メモ</th>
                  <th className="text-right px-3 py-3 font-medium text-slate-600">請求書</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                      読み込み中…
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                      アドレス帳に法人がありません。請求書の「アドレス帳」から登録してください。
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => {
                    const open = expandedId === r.id;
                    const firstLine = (r.billingNotes || "").split("\n")[0] ?? "";
                    const memoPreview =
                      firstLine.length > 40 ? `${firstLine.slice(0, 40)}…` : firstLine;
                    const tip = [
                      `シフト集計 ${fmt(r.systemRevenue)}`,
                      r.salesLogRevenueTotal ? `ログ＋ ${fmt(r.salesLogRevenueTotal)}` : null,
                      r.customMainTotal ? `手入力＋ ${fmt(r.customMainTotal)}` : null,
                      r.salesLogDeductionTotal ? `ログ控除 −${fmt(r.salesLogDeductionTotal)}` : null,
                      r.customDeductionTotal ? `手控除 −${fmt(r.customDeductionTotal)}` : null,
                    ]
                      .filter(Boolean)
                      .join(" / ");

                    return (
                      <Fragment key={r.id}>
                        <tr
                          onClick={() => openRow(r)}
                          className={`cursor-pointer border-b border-slate-100 hover:bg-slate-50/80 ${
                            r.courseCount === 0 ? "opacity-60" : ""
                          }`}
                        >
                          <td className={`sticky left-0 z-10 px-1 py-2 text-center ${open ? "bg-slate-50" : "bg-white"}`}>
                            <span
                              className="inline-flex items-center justify-center w-8 h-8 rounded text-slate-400"
                              aria-hidden
                            >
                              <FontAwesomeIcon
                                icon={open ? faChevronDown : faChevronRight}
                                className="w-3 h-3"
                              />
                            </span>
                          </td>
                          <td className={`sticky left-10 z-10 px-3 py-2 font-medium text-slate-900 ${open ? "bg-slate-50" : "bg-white"}`}>{r.name}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                            {r.courseCount}
                          </td>
                          <td
                            className="px-3 py-2 text-right font-medium text-slate-900 tabular-nums"
                            title={tip}
                          >
                            {fmt(r.monthTotal)}
                          </td>
                          <td
                            className="px-3 py-2 text-slate-600 text-xs max-w-[200px] truncate"
                            title={r.billingNotes || undefined}
                          >
                            {memoPreview.trim() ? memoPreview : "—"}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {canWrite ? (
                              <button
                                type="button"
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  setCreateInvoiceError(null);
                                  try {
                                    const res = await apiFetch<{ month: string; issueDate: string; dueDate: string; invoiceNo: string; tableData: { main: { title: string; qty: number; price: number }[]; deduct: { title: string; qty: number; price: number }[] } }>(
                                      `/api/admin/invoices/draft?month=${encodeURIComponent(month)}&section=${encodeURIComponent(r.suggestedSection)}&counterparty=${encodeURIComponent(r.id)}`
                                    );
                                    const amount =
                                      (res.tableData?.main ?? []).reduce((s, x) => s + (Number(x.qty) || 0) * (Number(x.price) || 0), 0) -
                                      (res.tableData?.deduct ?? []).reduce((s, x) => s + (Number(x.qty) || 0) * (Number(x.price) || 0), 0);
                                    const issueDateJp = `${res.issueDate.slice(0, 4)}年${Number(
                                      res.issueDate.slice(5, 7),
                                    )}月${Number(res.issueDate.slice(8, 10))}日`;
                                    const dueDateJp = `${res.dueDate.slice(0, 4)}年${Number(
                                      res.dueDate.slice(5, 7),
                                    )}月${Number(res.dueDate.slice(8, 10))}日`;
                                    const payload = {
                                      issueDate: issueDateJp,
                                      dueDate: dueDateJp,
                                      invoiceNo: res.invoiceNo,
                                      tableData: res.tableData,
                                      toName: r.name,
                                      subject: `${month.slice(0, 4)}年${Number(month.slice(5, 7))}月稼働分`,
                                      section: r.suggestedSection,
                                    };
                                    const created = await apiFetch<{ invoice: { id: string } }>("/api/admin/invoices", {
                                      method: "POST",
                                      body: JSON.stringify({
                                        month,
                                        section: r.suggestedSection,
                                        counterpartyInvoiceAddressId: r.id,
                                        clientName: r.name,
                                        issueDate: res.issueDate,
                                        invoiceNo: res.invoiceNo,
                                        amount,
                                        status: "draft",
                                        payload,
                                      }),
                                    });
                                    window.location.href = `/admin/invoices/new?invoiceId=${encodeURIComponent(
                                      created.invoice.id,
                                    )}&month=${encodeURIComponent(month)}&direction=outgoing&section=${encodeURIComponent(
                                      r.suggestedSection,
                                    )}&counterparty=${encodeURIComponent(r.id)}`;
                                  } catch (e) {
                                    console.error(e);
                                    setCreateInvoiceError("請求書の保存に失敗しました。DB migration適用状況とAPIエラーをご確認ください。");
                                  }
                                }}
                                className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 hover:text-slate-900 border border-slate-200 rounded-md px-2 py-1.5 hover:bg-slate-50"
                              >
                                <FontAwesomeIcon icon={faFileInvoice} className="w-3 h-3" />
                                請求書を保存して編集
                              </button>
                            ) : (
                              <span className="text-xs text-slate-400">—</span>
                            )}
                          </td>
                        </tr>
                        {open && (
                          <tr className="bg-slate-50/90 border-b border-slate-100">
                            <td colSpan={6} className="px-4 py-4">
                              <CounterpartyBillingExpand
                                counterpartyId={r.id}
                                month={month}
                                canWrite={canWrite}
                                onRefreshSummary={() => void load()}
                              />
                              <div className="mt-6 pt-4 border-t border-slate-200">
                                <label className="block text-xs font-medium text-slate-500 mb-1">
                                  社内メモ（請求書には出力されません）
                                </label>
                                <textarea
                                  className="w-full min-h-[80px] text-sm border border-slate-200 rounded-md px-3 py-2 focus:ring-2 focus:ring-slate-300 focus:border-slate-300 outline-none"
                                  value={draftNotes[r.id] ?? ""}
                                  disabled={!canWrite}
                                  onChange={(e) =>
                                    setDraftNotes((d) => ({ ...d, [r.id]: e.target.value }))
                                  }
                                  placeholder="契約・連絡メモ…"
                                />
                                {canWrite && (
                                  <button
                                    type="button"
                                    onClick={() => void saveNotes(r.id)}
                                    disabled={savingId === r.id}
                                    className="mt-2 inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md bg-white border border-slate-200 text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                                  >
                                    <FontAwesomeIcon icon={faFloppyDisk} className="w-3 h-3" />
                                    {savingId === r.id ? "保存中…" : "メモを保存"}
                                  </button>
                                )}
                                <p className="text-[11px] text-slate-500 mt-2">
                                  請求書の帯域の提案: {r.suggestedSection}
                                </p>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
