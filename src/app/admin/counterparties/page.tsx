"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faChevronDown,
  faChevronRight,
  faFileInvoice,
  faFloppyDisk,
  faPlus,
  faTrash,
} from "@fortawesome/free-solid-svg-icons";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { MonthYearPicker } from "@/lib/components/MonthYearPicker";
import { apiFetch, getStoredDriver } from "@/lib/api";
import { canAdminWrite } from "@/lib/authz";

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
  customLinesTotal: number;
  monthTotal: number;
  suggestedSection: "Amazon" | "ヤマト運輸" | "郵便局";
};

type SystemBillingLine = {
  kind: string;
  courseId: string;
  courseName: string;
  label: string;
  quantity: number;
  unitPrice: number;
  amount: number;
};

type CustomDraftRow = {
  key: string;
  description: string;
  quantity: number;
  unitPrice: number;
};

type BillingDetailPayload = {
  month: string;
  systemLines: SystemBillingLine[];
  customLines: { id: string; description: string; quantity: number; unitPrice: number; amount: number }[];
  systemTotal: number;
  customTotal: number;
  grandTotal: number;
};

const fmt = (n: number) => `¥${n.toLocaleString("ja-JP")}`;

function fmtQty(n: number) {
  if (Number.isInteger(n)) return String(n);
  return n.toLocaleString("ja-JP", { maximumFractionDigits: 4 });
}

function carrierLabel(c: CourseRow["carrier"]) {
  if (c === "AMAZON") return "Amazon";
  if (c === "YAMATO") return "ヤマト";
  return "その他";
}

function monthStrFromYm(y: number, m: number) {
  return `${y}-${String(m).padStart(2, "0")}`;
}

function customDraftFromApi(
  lines: BillingDetailPayload["customLines"]
): CustomDraftRow[] {
  return lines.map((l) => ({
    key: l.id,
    description: l.description,
    quantity: l.quantity,
    unitPrice: l.unitPrice,
  }));
}

function lineAmount(q: number, p: number) {
  return Math.round(q * p * 100) / 100;
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
  const [billingDetail, setBillingDetail] = useState<Record<string, BillingDetailPayload | null>>({});
  const [detailLoading, setDetailLoading] = useState<Record<string, boolean>>({});
  const [customDraft, setCustomDraft] = useState<Record<string, CustomDraftRow[]>>({});
  const [savingLinesId, setSavingLinesId] = useState<string | null>(null);

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

  useEffect(() => {
    setBillingDetail({});
    setCustomDraft({});
    setDetailLoading({});
  }, [month]);

  const fetchBillingDetail = useCallback(
    async (counterpartyId: string) => {
      setDetailLoading((d) => ({ ...d, [counterpartyId]: true }));
      try {
        const data = await apiFetch<BillingDetailPayload>(
          `/api/admin/counterparties/${counterpartyId}/billing-detail?month=${encodeURIComponent(month)}`
        );
        setBillingDetail((b) => ({ ...b, [counterpartyId]: data }));
        setCustomDraft((c) => ({ ...c, [counterpartyId]: customDraftFromApi(data.customLines) }));
      } catch (e) {
        console.error(e);
        setBillingDetail((b) => ({ ...b, [counterpartyId]: null }));
      } finally {
        setDetailLoading((d) => ({ ...d, [counterpartyId]: false }));
      }
    },
    [month]
  );

  useEffect(() => {
    if (!expandedId) return;
    void fetchBillingDetail(expandedId);
  }, [expandedId, fetchBillingDetail]);

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

  const saveCustomLines = async (counterpartyId: string) => {
    if (!canWrite) return;
    const draft = customDraft[counterpartyId] ?? [];
    setSavingLinesId(counterpartyId);
    try {
      await apiFetch(`/api/admin/counterparties/${counterpartyId}/month-lines?month=${encodeURIComponent(month)}`, {
        method: "PUT",
        body: JSON.stringify({
          lines: draft.map((r) => ({
            description: r.description,
            quantity: r.quantity,
            unit_price: r.unitPrice,
          })),
        }),
      });
      await fetchBillingDetail(counterpartyId);
      await load();
    } catch (e) {
      console.error(e);
    } finally {
      setSavingLinesId(null);
    }
  };

  const openDraftNotes = (r: CounterpartySummaryRow) => {
    setExpandedId((id) => (id === r.id ? null : r.id));
    setDraftNotes((d) => ({ ...d, [r.id]: r.billingNotes ?? "" }));
  };

  const addCustomRow = (counterpartyId: string) => {
    setCustomDraft((c) => ({
      ...c,
      [counterpartyId]: [
        ...(c[counterpartyId] ?? []),
        { key: `new-${Date.now()}-${Math.random().toString(36).slice(2)}`, description: "", quantity: 1, unitPrice: 0 },
      ],
    }));
  };

  const removeCustomRow = (counterpartyId: string, key: string) => {
    setCustomDraft((c) => ({
      ...c,
      [counterpartyId]: (c[counterpartyId] ?? []).filter((row) => row.key !== key),
    }));
  };

  const updateCustomRow = (
    counterpartyId: string,
    key: string,
    patch: Partial<Pick<CustomDraftRow, "description" | "quantity" | "unitPrice">>
  ) => {
    setCustomDraft((c) => ({
      ...c,
      [counterpartyId]: (c[counterpartyId] ?? []).map((row) =>
        row.key === key ? { ...row, ...patch } : row
      ),
    }));
  };

  const thCls = "border border-slate-200 px-2 py-2 font-medium text-slate-600 bg-slate-100";
  const tdCls = "border border-slate-200 px-2 py-1.5 align-middle";

  return (
    <AdminLayout>
      <div className="w-full max-w-6xl">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-xl font-bold text-slate-900">取引先</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              コース別の宅急便・ネコポス件数・固定（Amazon）稼働日、および手入力の明細行で月次を管理します。
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
          システム行は<strong>シフト＋承認済み日報</strong>から自動計算されます（固定売上コースは「稼働日×固定単価」）。手入力行は日割りリースなど任意の明細を足し込めます。郵便局帯の sales_log
          集計はコース単位に含まれません。
        </div>

        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[800px]">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="text-left px-3 py-3 font-medium text-slate-600 w-10" />
                  <th className="text-left px-3 py-3 font-medium text-slate-600">取引先（請求先）</th>
                  <th className="text-right px-3 py-3 font-medium text-slate-600">コース数</th>
                  <th className="text-right px-3 py-3 font-medium text-slate-600">
                    月次合計（{month}）
                  </th>
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
                    const detail = billingDetail[r.id];
                    const dLoading = detailLoading[r.id];
                    const draft = customDraft[r.id] ?? [];
                    const draftCustomSum = draft.reduce((s, row) => s + lineAmount(row.quantity, row.unitPrice), 0);

                    return (
                      <Fragment key={r.id}>
                        <tr
                          className={`border-b border-slate-100 hover:bg-slate-50/80 ${
                            r.courseCount === 0 ? "opacity-60" : ""
                          }`}
                        >
                          <td className="px-1 py-2 text-center">
                            <button
                              type="button"
                              onClick={() => openDraftNotes(r)}
                              className="p-2 rounded text-slate-500 hover:bg-slate-100"
                              aria-expanded={open}
                              title="明細・メモ"
                            >
                              <FontAwesomeIcon
                                icon={open ? faChevronDown : faChevronRight}
                                className="w-3 h-3"
                              />
                            </button>
                          </td>
                          <td className="px-3 py-2 font-medium text-slate-900">{r.name}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                            {r.courseCount}
                          </td>
                          <td
                            className="px-3 py-2 text-right font-medium text-slate-900 tabular-nums"
                            title={`システム ${fmt(r.systemRevenue)} ＋ 手入力 ${fmt(r.customLinesTotal)}`}
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
                              <Link
                                href={`/admin/invoices/new?month=${encodeURIComponent(month)}&section=${encodeURIComponent(r.suggestedSection)}&counterparty=${encodeURIComponent(r.id)}`}
                                className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 hover:text-slate-900 border border-slate-200 rounded-md px-2 py-1.5 hover:bg-slate-50"
                              >
                                <FontAwesomeIcon icon={faFileInvoice} className="w-3 h-3" />
                                請求書を作成
                              </Link>
                            ) : (
                              <span className="text-xs text-slate-400">—</span>
                            )}
                          </td>
                        </tr>
                        {open && (
                          <tr className="bg-slate-50/90 border-b border-slate-100">
                            <td colSpan={6} className="px-4 py-4">
                              <div className="space-y-5">
                                {dLoading && !detail ? (
                                  <p className="text-sm text-slate-500">明細を読み込み中…</p>
                                ) : detail ? (
                                  <>
                                    <div>
                                      <h3 className="text-xs font-semibold text-slate-700 mb-2">
                                        請求書風明細（システム集計・参照）
                                      </h3>
                                      <div className="rounded-md border border-slate-200 overflow-x-auto bg-white">
                                        <table className="w-full text-xs border-collapse min-w-[560px]">
                                          <thead>
                                            <tr>
                                              <th className={`${thCls} text-left min-w-[200px]`}>品目</th>
                                              <th className={`${thCls} text-right w-28`}>数量</th>
                                              <th className={`${thCls} text-right w-28`}>単価</th>
                                              <th className={`${thCls} text-right w-32`}>金額</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {detail.systemLines.length === 0 ? (
                                              <tr>
                                                <td colSpan={4} className={`${tdCls} text-slate-500`}>
                                                  紐づくコースがありません。
                                                </td>
                                              </tr>
                                            ) : (
                                              detail.systemLines.map((line, i) => (
                                                <tr key={`${line.kind}-${line.courseId}-${i}`} className="bg-slate-50/50">
                                                  <td className={`${tdCls} text-slate-800`}>{line.label}</td>
                                                  <td className={`${tdCls} text-right tabular-nums text-slate-700`}>
                                                    {line.kind === "course_fixed"
                                                      ? `${fmtQty(line.quantity)}日`
                                                      : fmtQty(line.quantity)}
                                                  </td>
                                                  <td className={`${tdCls} text-right tabular-nums text-slate-700`}>
                                                    {fmt(line.unitPrice)}
                                                  </td>
                                                  <td className={`${tdCls} text-right font-medium tabular-nums text-slate-900`}>
                                                    {fmt(line.amount)}
                                                  </td>
                                                </tr>
                                              ))
                                            )}
                                            <tr className="bg-slate-100 font-medium">
                                              <td colSpan={3} className={`${tdCls} text-right text-slate-700`}>
                                                システム集計 小計
                                              </td>
                                              <td className={`${tdCls} text-right tabular-nums text-slate-900`}>
                                                {fmt(detail.systemTotal)}
                                              </td>
                                            </tr>
                                          </tbody>
                                        </table>
                                      </div>
                                    </div>

                                    <div>
                                      <h3 className="text-xs font-semibold text-slate-700 mb-2">
                                        手入力明細（日割りリース代など）
                                      </h3>
                                      <div className="rounded-md border border-slate-200 overflow-x-auto bg-white">
                                        <table className="w-full text-xs border-collapse min-w-[620px]">
                                          <thead>
                                            <tr>
                                              <th className={`${thCls} text-left min-w-[200px]`}>品目</th>
                                              <th className={`${thCls} text-right w-28`}>数量</th>
                                              <th className={`${thCls} text-right w-28`}>単価</th>
                                              <th className={`${thCls} text-right w-32`}>金額</th>
                                              <th className={`${thCls} text-center w-12`} />
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {draft.length === 0 ? (
                                              <tr>
                                                <td colSpan={5} className={`${tdCls} text-slate-500`}>
                                                  行がありません。「行を追加」から入力してください。
                                                </td>
                                              </tr>
                                            ) : (
                                              draft.map((row) => (
                                                <tr key={row.key}>
                                                  <td className={tdCls}>
                                                    <input
                                                      type="text"
                                                      className="w-full border border-slate-200 rounded px-2 py-1 text-xs"
                                                      value={row.description}
                                                      disabled={!canWrite}
                                                      placeholder="例：車両リース（日割り）"
                                                      onChange={(e) =>
                                                        updateCustomRow(r.id, row.key, {
                                                          description: e.target.value,
                                                        })
                                                      }
                                                    />
                                                  </td>
                                                  <td className={tdCls}>
                                                    <input
                                                      type="number"
                                                      step="any"
                                                      className="w-full border border-slate-200 rounded px-2 py-1 text-xs text-right tabular-nums"
                                                      value={Number.isFinite(row.quantity) ? row.quantity : 0}
                                                      disabled={!canWrite}
                                                      onChange={(e) =>
                                                        updateCustomRow(r.id, row.key, {
                                                          quantity: e.target.value === "" ? 0 : Number(e.target.value),
                                                        })
                                                      }
                                                    />
                                                  </td>
                                                  <td className={tdCls}>
                                                    <input
                                                      type="number"
                                                      step="any"
                                                      className="w-full border border-slate-200 rounded px-2 py-1 text-xs text-right tabular-nums"
                                                      value={Number.isFinite(row.unitPrice) ? row.unitPrice : 0}
                                                      disabled={!canWrite}
                                                      onChange={(e) =>
                                                        updateCustomRow(r.id, row.key, {
                                                          unitPrice: e.target.value === "" ? 0 : Number(e.target.value),
                                                        })
                                                      }
                                                    />
                                                  </td>
                                                  <td className={`${tdCls} text-right font-medium tabular-nums text-slate-900`}>
                                                    {fmt(lineAmount(row.quantity, row.unitPrice))}
                                                  </td>
                                                  <td className={`${tdCls} text-center`}>
                                                    {canWrite ? (
                                                      <button
                                                        type="button"
                                                        title="行を削除"
                                                        onClick={() => removeCustomRow(r.id, row.key)}
                                                        className="p-1.5 rounded text-slate-400 hover:text-red-600 hover:bg-red-50"
                                                      >
                                                        <FontAwesomeIcon icon={faTrash} className="w-3.5 h-3.5" />
                                                      </button>
                                                    ) : null}
                                                  </td>
                                                </tr>
                                              ))
                                            )}
                                            <tr className="bg-slate-100 font-medium">
                                              <td colSpan={3} className={`${tdCls} text-right text-slate-700`}>
                                                手入力 小計（編集中）
                                              </td>
                                              <td className={`${tdCls} text-right tabular-nums text-slate-900`}>
                                                {fmt(draftCustomSum)}
                                              </td>
                                              <td className={tdCls} />
                                            </tr>
                                          </tbody>
                                        </table>
                                      </div>
                                      {canWrite && (
                                        <div className="flex flex-wrap items-center gap-2 mt-2">
                                          <button
                                            type="button"
                                            onClick={() => addCustomRow(r.id)}
                                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                                          >
                                            <FontAwesomeIcon icon={faPlus} className="w-3 h-3" />
                                            行を追加
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => void saveCustomLines(r.id)}
                                            disabled={savingLinesId === r.id}
                                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md bg-slate-800 text-white hover:bg-slate-700 disabled:opacity-50"
                                          >
                                            <FontAwesomeIcon icon={faFloppyDisk} className="w-3 h-3" />
                                            {savingLinesId === r.id ? "保存中…" : "手入力明細を保存"}
                                          </button>
                                          <span className="text-[11px] text-slate-500">
                                            保存後、上の月次合計に反映されます。
                                          </span>
                                        </div>
                                      )}
                                    </div>

                                    <div className="flex flex-wrap justify-end gap-6 text-sm border-t border-slate-200 pt-3">
                                      <div className="text-right space-y-1">
                                        <div>
                                          <div className="text-xs text-slate-500">合計（保存済み・DB）</div>
                                          <div className="font-bold text-slate-900 tabular-nums">
                                            {fmt(detail.grandTotal)}
                                          </div>
                                        </div>
                                        {Math.abs(draftCustomSum - detail.customTotal) > 0.005 && (
                                          <div className="text-xs text-amber-800">
                                            入力中プレビュー: {fmt(detail.systemTotal + draftCustomSum)}
                                            <span className="text-slate-500">（未保存の変更あり）</span>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </>
                                ) : (
                                  <p className="text-sm text-red-600">明細の取得に失敗しました。</p>
                                )}

                                <div>
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
                                    placeholder="例：契約番号・連絡先メモ…"
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
                                </div>
                                <p className="text-[11px] text-slate-500">
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
