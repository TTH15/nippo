"use client";

import { useEffect, useState } from "react";
import { SimpleSelect } from "@/lib/components/SimpleSelect";
import { DatePicker } from "@/lib/components/DatePicker";
import { dateToReportDateStr, reportDateStrToDate } from "@/lib/date";
import { groupFieldsByLabel, type ReportContentUnit } from "@/lib/reportContent";

// 編集で送信する 1 フィールド分の値（report_entries 縦持ち）
export type EditEntryValue = {
  unitId: string;
  fieldKey: string;
  valueNum: number | null;
  valueText: string | null;
};

type ReportData = {
  id?: string;
  report_date: string;
  submitted_at: string;
  carrier_name?: string | null;
  approved_at?: string | null;
  rejected_at?: string | null;
  content?: ReportContentUnit[];
};

type Entry = {
  driver: { id: string; name: string; display_name?: string | null };
  report: ReportData;
};

type EditForm = Record<string, string>;

interface EditReportModalProps {
  editingEntry: { entry: Entry; groupDate: string } | null;
  editForm: EditForm;
  setEditForm: (updater: (prev: EditForm) => EditForm) => void;
  savingEdit: boolean;
  saveError?: string | null;
  onClose: () => void;
  onSave: (entries: EditEntryValue[] | undefined) => void;
}

// content の値を入力欄の文字列へ
function initialValues(units: ReportContentUnit[]): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  units.forEach((u) => {
    out[u.unitId] = {};
    u.fields.forEach((f) => {
      out[u.unitId][f.fieldKey] =
        f.inputType === "BOOL"
          ? f.valueText === "true" || f.valueNum === 1
            ? "true"
            : "false"
          : f.inputType === "INT"
            ? f.valueNum != null
              ? String(f.valueNum)
              : ""
            : (f.valueText ?? "");
    });
  });
  return out;
}

export default function EditReportModal({
  editingEntry,
  editForm,
  setEditForm,
  savingEdit,
  saveError,
  onClose,
  onSave,
}: EditReportModalProps) {
  const units = editingEntry?.entry.report.content ?? [];
  const reportId = editingEntry?.entry.report.id;
  const [values, setValues] = useState<Record<string, Record<string, string>>>({});

  // 対象日報が変わるたびに現在値で初期化
  useEffect(() => {
    setValues(initialValues(editingEntry?.entry.report.content ?? []));
  }, [reportId, editingEntry]);

  if (!editingEntry) return null;

  const statusValue = (editForm.status as "approved" | "rejected" | undefined) ?? undefined;

  const reportDateValue =
    editForm.report_date && /^\d{4}-\d{2}-\d{2}$/.test(editForm.report_date)
      ? reportDateStrToDate(editForm.report_date)
      : undefined;

  const setVal = (unitId: string, fieldKey: string, v: string) =>
    setValues((prev) => ({
      ...prev,
      [unitId]: { ...prev[unitId], [fieldKey]: v },
    }));

  const buildEntries = (): EditEntryValue[] =>
    units.flatMap((u) =>
      u.fields.map((f) => {
        const raw = values[u.unitId]?.[f.fieldKey] ?? "";
        if (f.inputType === "INT") {
          return { unitId: u.unitId, fieldKey: f.fieldKey, valueNum: raw.trim() ? Number(raw) : 0, valueText: null };
        }
        if (f.inputType === "BOOL") {
          return { unitId: u.unitId, fieldKey: f.fieldKey, valueNum: null, valueText: raw === "true" ? "true" : "false" };
        }
        return { unitId: u.unitId, fieldKey: f.fieldKey, valueNum: null, valueText: raw };
      }),
    );

  const carrierName = editingEntry.entry.report.carrier_name;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-lg w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-1">
            日報の編集 — {editingEntry.entry.driver.display_name ?? editingEntry.entry.driver.name}
            {carrierName ? <span className="text-sm font-normal text-slate-500"> / {carrierName}</span> : null}
          </h2>
          <p className="text-xs text-slate-500 mb-4">
            承認済みの日報を編集すると、売上・報酬・集計にもその内容が反映されます。
            日付を変えた場合は一覧の別の日付ブロックへ移動します（未承認タブは直近14日のみ表示）。
          </p>
          {saveError ? (
            <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
              {saveError}
            </div>
          ) : null}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">日付</label>
              <DatePicker
                value={reportDateValue}
                onChange={(d) =>
                  setEditForm((f) => ({
                    ...f,
                    report_date: d ? dateToReportDateStr(d) : "",
                  }))
                }
                className="w-full"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">承認ステータス</label>
              <SimpleSelect
                options={[
                  { value: "approved", label: "承認済み" },
                  { value: "rejected", label: "却下" },
                ]}
                value={statusValue ?? undefined}
                onChange={(v) =>
                  setEditForm((f) => ({
                    ...f,
                    status: v,
                  }))
                }
                placeholder="変更しない"
                clearable
                size="sm"
              />
              <p className="mt-1 text-[11px] text-slate-500">
                ステータスを変更しない場合は未選択のままにしてください。
              </p>
            </div>

            {units.length === 0 ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800">
                この日報には編集できる報告項目がありません。
              </div>
            ) : (
              <div className="space-y-4">
                {units.map((u) => (
                  <div key={u.unitId} className="rounded-lg border border-slate-200">
                    <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50 rounded-t-lg">
                      <span className="text-sm font-semibold text-slate-800">{u.unitName}</span>
                    </div>
                    <div className="p-4 space-y-4">
                      {groupFieldsByLabel(u.fields).map((g, gi) => (
                        <div key={`${u.unitId}-${gi}`}>
                          {g.label && (
                            <div className="text-xs font-semibold text-amber-600 mb-2">{g.label}</div>
                          )}
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            {g.fields.map((f) => {
                              const val = values[u.unitId]?.[f.fieldKey] ?? "";
                              if (f.inputType === "BOOL") {
                                return (
                                  <label
                                    key={f.fieldKey}
                                    className="flex items-center gap-2 rounded border border-slate-200 px-3 py-2"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={val === "true"}
                                      onChange={(e) => setVal(u.unitId, f.fieldKey, e.target.checked ? "true" : "false")}
                                      className="h-4 w-4 accent-slate-800"
                                    />
                                    <span className="text-xs text-slate-700">{f.label}</span>
                                  </label>
                                );
                              }
                              const isInt = f.inputType === "INT";
                              return (
                                <div key={f.fieldKey}>
                                  <label className="block text-xs font-medium text-slate-600 mb-1">{f.label}</label>
                                  <input
                                    type={isInt ? "number" : f.inputType === "TIME" ? "time" : "text"}
                                    inputMode={isInt ? "numeric" : undefined}
                                    min={isInt ? 0 : undefined}
                                    placeholder={isInt ? "0" : ""}
                                    value={val}
                                    onChange={(e) => setVal(u.unitId, f.fieldKey, e.target.value)}
                                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded"
                                  />
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 mt-6">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-800"
            >
              キャンセル
            </button>
            <button
              type="button"
              onClick={() => onSave(units.length ? buildEntries() : undefined)}
              disabled={savingEdit}
              className="px-4 py-1.5 bg-slate-800 text-white text-sm font-medium rounded hover:bg-slate-700 disabled:opacity-50"
            >
              {savingEdit ? "保存中..." : "保存"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
