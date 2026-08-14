"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faFloppyDisk, faLinkSlash, faPlus, faTrash } from "@fortawesome/free-solid-svg-icons";
import { apiFetch } from "@/lib/api";
import { useApi } from "@/lib/useApi";

type MainLine = {
  lineKey: string;
  rowType: "system" | "sales_log_revenue" | "merged" | "custom_main";
  refId: string | null;
  defaultLabel: string;
  label: string;
  quantity: number;
  unitPrice: number;
  amount: number;
};

type DeductLine = {
  lineKey: string;
  rowType: "sales_log_loss" | "custom_deduction";
  refId: string | null;
  defaultLabel: string;
  label: string;
  quantity: number;
  unitPrice: number;
  amount: number;
};

type BillingDetail = {
  month: string;
  mainLines: MainLine[];
  deductLines: DeductLine[];
  shiftSystemTotal: number;
  mainSubtotal: number;
  deductSubtotal: number;
  grandTotal: number;
};

type DraftRow = { key: string; description: string; quantity: number; unitPrice: number };

const fmt = (n: number) => `¥${n.toLocaleString("ja-JP")}`;

function fmtQty(n: number) {
  if (Number.isInteger(n)) return String(n);
  return n.toLocaleString("ja-JP", { maximumFractionDigits: 4 });
}

function rowBadge(t: MainLine["rowType"] | DeductLine["rowType"]) {
  if (t === "system") return "システム";
  if (t === "sales_log_revenue" || t === "sales_log_loss") return "売上ログ";
  if (t === "merged") return "統合";
  if (t === "custom_main" || t === "custom_deduction") return "手入力";
  return "";
}

function mergeableMainRow(t: MainLine["rowType"]) {
  return t === "system" || t === "sales_log_revenue" || t === "custom_main";
}

const thCls = "border border-slate-200 px-2 py-2 font-medium text-slate-600 bg-slate-100";
const tdCls = "border border-slate-200 px-2 py-1.5 align-middle";

export function CounterpartyBillingExpand({
  counterpartyId,
  month,
  canWrite,
  onRefreshSummary,
}: {
  counterpartyId: string;
  month: string;
  canWrite: boolean;
  onRefreshSummary: () => void;
}) {
  const [detail, setDetail] = useState<BillingDetail | null>(null);
  const [draftMain, setDraftMain] = useState<DraftRow[]>([]);
  const [draftDed, setDraftDed] = useState<DraftRow[]>([]);
  const [savingCustom, setSavingCustom] = useState(false);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [mergeOpen, setMergeOpen] = useState<{ keys: string[]; description: string } | null>(null);
  const [mergeBusy, setMergeBusy] = useState(false);

  const recomputeTotals = useCallback((base: BillingDetail): BillingDetail => {
    const mainSubtotal = base.mainLines.reduce((sum, l) => sum + (Number(l.amount) || 0), 0);
    const deductSubtotal = base.deductLines.reduce((sum, l) => sum + (Number(l.amount) || 0), 0);
    return {
      ...base,
      mainSubtotal,
      deductSubtotal,
      grandTotal: mainSubtotal - deductSubtotal,
    };
  }, []);

  // SWR でキャッシュする（開閉・再訪のたびに org 全体を再集計しない。再訪時は
  // キャッシュを即表示して裏で再検証）。編集の楽観更新のため detail は state に転写する。
  const {
    data: detailData,
    error: detailError,
    isInitialLoading,
    mutate: mutateDetail,
  } = useApi<BillingDetail>(
    `/api/admin/counterparties/${counterpartyId}/billing-detail?month=${encodeURIComponent(month)}`,
    { revalidateOnFocus: false },
  );
  const loading = isInitialLoading;
  const load = useCallback(() => mutateDetail(), [mutateDetail]);

  useEffect(() => {
    if (!detailData) return;
    setDetail(detailData);
    setDraftMain(
      detailData.mainLines
        .filter((l) => l.rowType === "custom_main")
        .map((l) => ({
          key: l.refId ?? l.lineKey,
          description: l.label,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
        }))
    );
    setDraftDed(
      detailData.deductLines
        .filter((l) => l.rowType === "custom_deduction")
        .map((l) => ({
          key: l.refId ?? l.lineKey,
          description: l.label,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
        }))
    );
  }, [detailData]);
  useEffect(() => {
    if (detailError) setDetail(null);
  }, [detailError]);

  // セル1つの blur ごとに全社サマリを即再集計しない。1.5s のデバウンスでまとめて1回。
  const summaryTimerRef = useRef<number | null>(null);
  const scheduleSummaryRefresh = useCallback(() => {
    if (summaryTimerRef.current != null) window.clearTimeout(summaryTimerRef.current);
    summaryTimerRef.current = window.setTimeout(() => {
      summaryTimerRef.current = null;
      onRefreshSummary();
    }, 1500);
  }, [onRefreshSummary]);
  useEffect(() => {
    return () => {
      if (summaryTimerRef.current != null) window.clearTimeout(summaryTimerRef.current);
    };
  }, []);

  const saveLabelBlur = async (
    lineKey: string,
    nextLabel: string,
    rowType: MainLine["rowType"] | DeductLine["rowType"],
    refId: string | null
  ) => {
    if (!canWrite) return;
    const trimmed = nextLabel.trim();
    try {
      if (rowType === "merged" && refId) {
        await apiFetch(`/api/admin/counterparties/${counterpartyId}/merged-lines/${refId}`, {
          method: "PATCH",
          body: JSON.stringify({ description: trimmed }),
        });
      } else if ((rowType === "custom_main" || rowType === "custom_deduction") && refId) {
        await apiFetch(
          `/api/admin/counterparties/${counterpartyId}/custom-lines/${refId}?month=${encodeURIComponent(month)}`,
          {
            method: "PATCH",
            body: JSON.stringify({ description: trimmed }),
          }
        );
      } else {
        await apiFetch(`/api/admin/counterparties/${counterpartyId}/line-label`, {
          method: "PATCH",
          body: JSON.stringify({ month, lineKey, displayLabel: trimmed }),
        });
      }
      setDetail((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          mainLines: prev.mainLines.map((l) => (l.lineKey === lineKey ? { ...l, label: trimmed } : l)),
          deductLines: prev.deductLines.map((l) => (l.lineKey === lineKey ? { ...l, label: trimmed } : l)),
        };
      });
      if (rowType === "custom_main" && refId) {
        setDraftMain((prev) => prev.map((r) => (r.key === refId ? { ...r, description: trimmed } : r)));
      } else if (rowType === "custom_deduction" && refId) {
        setDraftDed((prev) => prev.map((r) => (r.key === refId ? { ...r, description: trimmed } : r)));
      }
    } catch (e) {
      console.error(e);
    }
  };

  const saveCustomQtyPrice = async (
    refId: string,
    quantity: number,
    unitPrice: number,
    kind: "main" | "deduction"
  ) => {
    if (!canWrite) return;
    try {
      await apiFetch(
        `/api/admin/counterparties/${counterpartyId}/custom-lines/${refId}?month=${encodeURIComponent(month)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ quantity, unit_price: unitPrice }),
        }
      );
      setDetail((prev) => {
        if (!prev) return prev;
        const applyMain = prev.mainLines.map((l) =>
          l.refId === refId
            ? {
                ...l,
                quantity,
                unitPrice,
                amount: Math.round(quantity * unitPrice),
              }
            : l,
        );
        const applyDeduct = prev.deductLines.map((l) =>
          l.refId === refId
            ? {
                ...l,
                quantity,
                unitPrice,
                amount: Math.round(quantity * unitPrice),
              }
            : l,
        );
        return recomputeTotals({
          ...prev,
          mainLines: applyMain,
          deductLines: applyDeduct,
        });
      });
      if (kind === "main") {
        setDraftMain((prev) =>
          prev.map((r) => (r.key === refId ? { ...r, quantity, unitPrice } : r)),
        );
      } else {
        setDraftDed((prev) =>
          prev.map((r) => (r.key === refId ? { ...r, quantity, unitPrice } : r)),
        );
      }
      scheduleSummaryRefresh();
    } catch (e) {
      console.error(e);
    }
  };

  const saveHandInput = async () => {
    if (!canWrite) return;
    setSavingCustom(true);
    try {
      await apiFetch(
        `/api/admin/counterparties/${counterpartyId}/month-lines?month=${encodeURIComponent(month)}`,
        {
          method: "PUT",
          body: JSON.stringify({
            mainLines: draftMain.map((r) => ({
              description: r.description,
              quantity: r.quantity,
              unit_price: r.unitPrice,
            })),
            deductionLines: draftDed.map((r) => ({
              description: r.description,
              quantity: r.quantity,
              unit_price: r.unitPrice,
            })),
          }),
        }
      );
      onRefreshSummary();
      // 体感速度優先: 画面操作を先に返し、整合はバックグラウンドで再取得
      void load();
    } catch (e) {
      console.error(e);
    } finally {
      setSavingCustom(false);
    }
  };

  const unmerge = async (mergeId: string) => {
    if (!canWrite) return;
    try {
      await apiFetch(`/api/admin/counterparties/${counterpartyId}/merged-lines/${mergeId}`, {
        method: "DELETE",
      });
      onRefreshSummary();
      void load();
    } catch (e) {
      console.error(e);
    }
  };

  const submitMerge = async () => {
    if (!mergeOpen || !canWrite) return;
    const desc = mergeOpen.description.trim();
    if (!desc) return;
    setMergeBusy(true);
    try {
      await apiFetch(`/api/admin/counterparties/${counterpartyId}/merge-lines`, {
        method: "POST",
        body: JSON.stringify({
          month,
          sourceLineKeys: mergeOpen.keys,
          description: desc,
        }),
      });
      setMergeOpen(null);
      onRefreshSummary();
      void load();
    } catch (e) {
      console.error(e);
    } finally {
      setMergeBusy(false);
    }
  };

  const onDropOnRow = (targetKey: string, targetLine: MainLine) => {
    if (!canWrite || !dragKey || dragKey === targetKey) return;
    const src = detail?.mainLines.find((l) => l.lineKey === dragKey);
    if (!src || !mergeableMainRow(src.rowType)) return;
    if (!mergeableMainRow(targetLine.rowType)) return;
    if (Math.abs(src.unitPrice - targetLine.unitPrice) >= 0.005) return;
    setMergeOpen({ keys: [dragKey, targetKey], description: "" });
    setDragKey(null);
  };

  if (loading && !detail) {
    return <p className="text-sm text-slate-500">明細を読み込み中…</p>;
  }
  if (!detail) {
    return <p className="text-sm text-red-600">明細の取得に失敗しました。</p>;
  }

  return (
    <div className="space-y-5">
      <p className="text-[11px] text-slate-500">
        単価が同じ行同士をドラッグ＆ドロップで重ねると統合できます。摘要はどの行もフォーカスが外れたときに保存されます（統合行はDBの摘要を更新）。
      </p>

      <div>
        <h3 className="text-xs font-semibold text-slate-700 mb-2">請求プラス明細</h3>
        <div className="rounded-md border border-slate-200 overflow-x-auto bg-white">
          <table className="w-full text-xs border-collapse min-w-[720px]">
            <thead>
              <tr>
                <th className={`${thCls} text-left w-24`}>種別</th>
                <th className={`${thCls} text-left min-w-[200px]`}>摘要</th>
                <th className={`${thCls} text-right w-28`}>数量</th>
                <th className={`${thCls} text-right w-28`}>単価</th>
                <th className={`${thCls} text-right w-32`}>金額</th>
                <th className={`${thCls} text-center w-16`} />
              </tr>
            </thead>
            <tbody>
              {detail.mainLines.map((line) => {
                const canDrag = canWrite && mergeableMainRow(line.rowType);
                const customEditable = line.rowType === "custom_main" && line.refId;
                return (
                  <tr
                    key={line.lineKey}
                    draggable={canDrag}
                    onDragStart={() => canDrag && setDragKey(line.lineKey)}
                    onDragEnd={() => setDragKey(null)}
                    onDragOver={(e) => {
                      if (dragKey && dragKey !== line.lineKey) e.preventDefault();
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      onDropOnRow(line.lineKey, line);
                    }}
                    className={dragKey === line.lineKey ? "bg-amber-50/80" : "bg-white"}
                  >
                    <td className={tdCls}>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                        {rowBadge(line.rowType)}
                      </span>
                    </td>
                    <td className={tdCls}>
                      <input
                        type="text"
                        className="w-full border border-slate-200 rounded px-2 py-1 text-xs"
                        defaultValue={line.label}
                        key={`${line.lineKey}-${line.label}`}
                        disabled={!canWrite}
                        onBlur={(e) => {
                          if (e.target.value.trim() === line.label.trim()) return;
                          void saveLabelBlur(line.lineKey, e.target.value, line.rowType, line.refId);
                        }}
                      />
                    </td>
                    <td className={tdCls}>
                      {customEditable ? (
                        <input
                          type="number"
                          step="any"
                          className="w-full border border-slate-200 rounded px-2 py-1 text-xs text-right tabular-nums"
                          defaultValue={line.quantity}
                          key={`q-${line.lineKey}`}
                          disabled={!canWrite}
                          onBlur={(e) => {
                            const q = e.target.value === "" ? 0 : Number(e.target.value);
                            if (!Number.isFinite(q) || !line.refId) return;
                            if (q === line.quantity) return;
                            void saveCustomQtyPrice(line.refId, q, line.unitPrice, "main");
                          }}
                        />
                      ) : (
                        <span className="text-right tabular-nums block text-slate-800">
                          {line.lineKey.startsWith("fx:") ? `${fmtQty(line.quantity)}日` : fmtQty(line.quantity)}
                        </span>
                      )}
                    </td>
                    <td className={tdCls}>
                      {customEditable ? (
                        <input
                          type="number"
                          step="any"
                          className="w-full border border-slate-200 rounded px-2 py-1 text-xs text-right tabular-nums"
                          defaultValue={line.unitPrice}
                          key={`p-${line.lineKey}`}
                          disabled={!canWrite}
                          onBlur={(e) => {
                            const p = e.target.value === "" ? 0 : Number(e.target.value);
                            if (!Number.isFinite(p) || !line.refId) return;
                            if (p === line.unitPrice) return;
                            void saveCustomQtyPrice(line.refId, line.quantity, p, "main");
                          }}
                        />
                      ) : (
                        <span className="text-right tabular-nums block text-slate-800">{fmt(line.unitPrice)}</span>
                      )}
                    </td>
                    <td className={`${tdCls} text-right font-medium tabular-nums text-slate-900`}>
                      {fmt(line.amount)}
                    </td>
                    <td className={`${tdCls} text-center`}>
                      {line.rowType === "merged" && line.refId && canWrite ? (
                        <button
                          type="button"
                          title="統合を解除"
                          onClick={() => void unmerge(line.refId!)}
                          className="p-1.5 rounded text-slate-400 hover:text-amber-700 hover:bg-amber-50"
                        >
                          <FontAwesomeIcon icon={faLinkSlash} className="w-3.5 h-3.5" />
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
              <tr className="bg-slate-100 font-medium">
                <td colSpan={4} className={`${tdCls} text-right text-slate-700`}>
                  プラス明細 小計
                </td>
                <td className={`${tdCls} text-right tabular-nums text-slate-900`}>
                  {fmt(detail.mainSubtotal)}
                </td>
                <td className={tdCls} />
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h3 className="text-xs font-semibold text-slate-700 mb-2">控除（請求から差し引き）</h3>
        <p className="text-[11px] text-slate-500 mb-2">
          売上ログで利益がマイナスの行はここに表示されます。手入力の控除行も追加できます。
        </p>
        <div className="rounded-md border border-slate-200 overflow-x-auto bg-white">
          <table className="w-full text-xs border-collapse min-w-[720px]">
            <thead>
              <tr>
                <th className={`${thCls} text-left w-24`}>種別</th>
                <th className={`${thCls} text-left min-w-[200px]`}>摘要</th>
                <th className={`${thCls} text-right w-28`}>数量</th>
                <th className={`${thCls} text-right w-28`}>単価</th>
                <th className={`${thCls} text-right w-32`}>控除額</th>
              </tr>
            </thead>
            <tbody>
              {detail.deductLines.length === 0 ? (
                <tr>
                  <td colSpan={5} className={`${tdCls} text-slate-500`}>
                    控除行はありません。
                  </td>
                </tr>
              ) : (
                detail.deductLines.map((line) => {
                  const customEditable = line.rowType === "custom_deduction" && line.refId;
                  return (
                    <tr key={line.lineKey}>
                      <td className={tdCls}>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-800">
                          {rowBadge(line.rowType)}
                        </span>
                      </td>
                      <td className={tdCls}>
                        <input
                          type="text"
                          className="w-full border border-slate-200 rounded px-2 py-1 text-xs"
                          defaultValue={line.label}
                          key={`d-${line.lineKey}-${line.label}`}
                          disabled={!canWrite}
                          onBlur={(e) => {
                            if (e.target.value.trim() === line.label.trim()) return;
                            void saveLabelBlur(line.lineKey, e.target.value, line.rowType, line.refId);
                          }}
                        />
                      </td>
                      <td className={tdCls}>
                        {customEditable ? (
                          <input
                            type="number"
                            step="any"
                            className="w-full border border-slate-200 rounded px-2 py-1 text-xs text-right tabular-nums"
                            defaultValue={line.quantity}
                            key={`dq-${line.lineKey}`}
                            disabled={!canWrite}
                            onBlur={(e) => {
                              const q = e.target.value === "" ? 0 : Number(e.target.value);
                              if (!Number.isFinite(q) || !line.refId) return;
                              if (q === line.quantity) return;
                              void saveCustomQtyPrice(line.refId, q, line.unitPrice, "deduction");
                            }}
                          />
                        ) : (
                          <span className="text-right tabular-nums block">{fmtQty(line.quantity)}</span>
                        )}
                      </td>
                      <td className={tdCls}>
                        {customEditable ? (
                          <input
                            type="number"
                            step="any"
                            className="w-full border border-slate-200 rounded px-2 py-1 text-xs text-right tabular-nums"
                            defaultValue={line.unitPrice}
                            key={`dp-${line.lineKey}`}
                            disabled={!canWrite}
                            onBlur={(e) => {
                              const p = e.target.value === "" ? 0 : Number(e.target.value);
                              if (!Number.isFinite(p) || !line.refId) return;
                              if (p === line.unitPrice) return;
                              void saveCustomQtyPrice(line.refId, line.quantity, p, "deduction");
                            }}
                          />
                        ) : (
                          <span className="text-right tabular-nums block">{fmt(line.unitPrice)}</span>
                        )}
                      </td>
                      <td className={`${tdCls} text-right font-medium tabular-nums text-red-700`}>
                        {fmt(line.amount)}
                      </td>
                    </tr>
                  );
                })
              )}
              <tr className="bg-red-50/80 font-medium">
                <td colSpan={4} className={`${tdCls} text-right text-red-900`}>
                  控除 小計
                </td>
                <td className={`${tdCls} text-right tabular-nums text-red-800`}>
                  {fmt(detail.deductSubtotal)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-4 space-y-4">
        <h3 className="text-xs font-semibold text-slate-800">手入力の加算・控除（まとめて保存）</h3>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <div className="text-[11px] font-medium text-slate-600 mb-1">加算行</div>
            {draftMain.length === 0 ? (
              <p className="text-xs text-slate-400 py-2">行がありません</p>
            ) : (
              draftMain.map((row, idx) => (
                <div key={row.key} className="flex flex-wrap gap-2 mb-2 items-center">
                  <input
                    type="text"
                    className="flex-1 min-w-[120px] border border-slate-200 rounded px-2 py-1 text-xs"
                    placeholder="摘要"
                    value={row.description}
                    disabled={!canWrite}
                    onChange={(e) =>
                      setDraftMain((d) =>
                        d.map((r, i) => (i === idx ? { ...r, description: e.target.value } : r))
                      )
                    }
                  />
                  <input
                    type="number"
                    step="any"
                    className="w-20 border border-slate-200 rounded px-2 py-1 text-xs text-right"
                    value={row.quantity}
                    disabled={!canWrite}
                    onChange={(e) =>
                      setDraftMain((d) =>
                        d.map((r, i) =>
                          i === idx ? { ...r, quantity: Number(e.target.value) || 0 } : r
                        )
                      )
                    }
                  />
                  <input
                    type="number"
                    step="any"
                    className="w-24 border border-slate-200 rounded px-2 py-1 text-xs text-right"
                    value={row.unitPrice}
                    disabled={!canWrite}
                    onChange={(e) =>
                      setDraftMain((d) =>
                        d.map((r, i) =>
                          i === idx ? { ...r, unitPrice: Number(e.target.value) || 0 } : r
                        )
                      )
                    }
                  />
                  {canWrite && (
                    <button
                      type="button"
                      className="p-1 text-slate-400 hover:text-red-600"
                      onClick={() => setDraftMain((d) => d.filter((_, i) => i !== idx))}
                    >
                      <FontAwesomeIcon icon={faTrash} className="w-3 h-3" />
                    </button>
                  )}
                </div>
              ))
            )}
            {canWrite && (
              <button
                type="button"
                onClick={() =>
                  setDraftMain((d) => [
                    ...d,
                    { key: `n-${Date.now()}`, description: "", quantity: 1, unitPrice: 0 },
                  ])
                }
                className="mt-1 inline-flex items-center gap-1 text-xs text-slate-700 border border-slate-200 rounded px-2 py-1 bg-white hover:bg-slate-50"
              >
                <FontAwesomeIcon icon={faPlus} className="w-3 h-3" />
                加算行を追加
              </button>
            )}
          </div>
          <div>
            <div className="text-[11px] font-medium text-slate-600 mb-1">控除行</div>
            {draftDed.length === 0 ? (
              <p className="text-xs text-slate-400 py-2">行がありません</p>
            ) : (
              draftDed.map((row, idx) => (
                <div key={row.key} className="flex flex-wrap gap-2 mb-2 items-center">
                  <input
                    type="text"
                    className="flex-1 min-w-[120px] border border-slate-200 rounded px-2 py-1 text-xs"
                    placeholder="摘要"
                    value={row.description}
                    disabled={!canWrite}
                    onChange={(e) =>
                      setDraftDed((d) =>
                        d.map((r, i) => (i === idx ? { ...r, description: e.target.value } : r))
                      )
                    }
                  />
                  <input
                    type="number"
                    step="any"
                    className="w-20 border border-slate-200 rounded px-2 py-1 text-xs text-right"
                    value={row.quantity}
                    disabled={!canWrite}
                    onChange={(e) =>
                      setDraftDed((d) =>
                        d.map((r, i) =>
                          i === idx ? { ...r, quantity: Number(e.target.value) || 0 } : r
                        )
                      )
                    }
                  />
                  <input
                    type="number"
                    step="any"
                    className="w-24 border border-slate-200 rounded px-2 py-1 text-xs text-right"
                    value={row.unitPrice}
                    disabled={!canWrite}
                    onChange={(e) =>
                      setDraftDed((d) =>
                        d.map((r, i) =>
                          i === idx ? { ...r, unitPrice: Number(e.target.value) || 0 } : r
                        )
                      )
                    }
                  />
                  {canWrite && (
                    <button
                      type="button"
                      className="p-1 text-slate-400 hover:text-red-600"
                      onClick={() => setDraftDed((d) => d.filter((_, i) => i !== idx))}
                    >
                      <FontAwesomeIcon icon={faTrash} className="w-3 h-3" />
                    </button>
                  )}
                </div>
              ))
            )}
            {canWrite && (
              <button
                type="button"
                onClick={() =>
                  setDraftDed((d) => [
                    ...d,
                    { key: `nd-${Date.now()}`, description: "", quantity: 1, unitPrice: 0 },
                  ])
                }
                className="mt-1 inline-flex items-center gap-1 text-xs text-red-800 border border-red-200 rounded px-2 py-1 bg-white hover:bg-red-50/50"
              >
                <FontAwesomeIcon icon={faPlus} className="w-3 h-3" />
                控除行を追加
              </button>
            )}
          </div>
        </div>
        {canWrite && (
          <button
            type="button"
            disabled={savingCustom}
            onClick={() => void saveHandInput()}
            className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-md bg-slate-800 text-white hover:bg-slate-700 disabled:opacity-50"
          >
            <FontAwesomeIcon icon={faFloppyDisk} className="w-3 h-3" />
            {savingCustom ? "保存中…" : "手入力の加算・控除を保存"}
          </button>
        )}
      </div>

      <div className="flex flex-wrap justify-end gap-4 text-sm border-t border-slate-200 pt-3">
        <div className="text-right text-xs text-slate-500">
          シフト集計（参考） <span className="font-mono text-slate-800">{fmt(detail.shiftSystemTotal)}</span>
        </div>
        <div className="text-right">
          <div className="text-xs text-slate-500">請求純額（プラス − 控除）</div>
          <div className="text-lg font-bold text-slate-900 tabular-nums">{fmt(detail.grandTotal)}</div>
        </div>
      </div>

      {mergeOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setMergeOpen(null)}>
          {/* 行数が多いと画面外へ伸びてボタンに届かなくなるため高さを制限してスクロールさせる */}
          <div
            className="bg-white rounded-lg shadow-xl max-w-md w-full max-h-[85vh] overflow-y-auto p-4 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <h4 className="text-sm font-semibold text-slate-900">明細を統合</h4>
            <p className="text-xs text-slate-600">単価が一致する行を1つにまとめます。統合後の摘要を入力してください。</p>
            <input
              type="text"
              className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm"
              placeholder="新しい摘要"
              value={mergeOpen.description}
              onChange={(e) => setMergeOpen((m) => (m ? { ...m, description: e.target.value } : m))}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="px-3 py-1.5 text-xs rounded border border-slate-200"
                onClick={() => setMergeOpen(null)}
              >
                キャンセル
              </button>
              <button
                type="button"
                disabled={mergeBusy || !mergeOpen.description.trim()}
                className="px-3 py-1.5 text-xs rounded bg-slate-800 text-white disabled:opacity-50"
                onClick={() => void submitMerge()}
              >
                統合する
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
