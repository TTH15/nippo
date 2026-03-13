"use client";

import { SimpleSelect } from "@/lib/components/SimpleSelect";
import type { SelectOption } from "@/lib/components/CustomSelect";

type ReportData = {
  id?: string;
  report_date: string;
  takuhaibin_completed: number;
  takuhaibin_returned: number;
  nekopos_completed: number;
  nekopos_returned: number;
  submitted_at: string;
  carrier?: "YAMATO" | "AMAZON";
  approved_at?: string | null;
  rejected_at?: string | null;
  amazon_am_mochidashi?: number;
  amazon_am_completed?: number;
  amazon_pm_mochidashi?: number;
  amazon_pm_completed?: number;
  amazon_4_mochidashi?: number;
  amazon_4_completed?: number;
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
  onClose: () => void;
  onSave: () => void;
}

export default function EditReportModal({
  editingEntry,
  editForm,
  setEditForm,
  savingEdit,
  onClose,
  onSave,
}: EditReportModalProps) {
  if (!editingEntry) return null;

  const carrierOptions: SelectOption[] = [
    { value: "YAMATO", label: "ヤマト" },
    { value: "AMAZON", label: "Amazon" },
  ];

  const carrierValue = editForm.carrier ?? "YAMATO";
  const isYamato = carrierValue === "YAMATO";

  const handleChange = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setEditForm((f) => ({ ...f, [key]: value }));
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-lg w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-1">
            日報の編集 — {editingEntry.entry.driver.display_name ?? editingEntry.entry.driver.name}
          </h2>
          <p className="text-xs text-slate-500 mb-4">
            承認済みの日報を編集すると、売上・報酬・集計にもその内容が反映されます。
          </p>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">日付</label>
              <input
                type="date"
                value={editForm.report_date ?? ""}
                onChange={(e) => setEditForm((f) => ({ ...f, report_date: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">種別</label>
              <SimpleSelect
                options={carrierOptions}
                value={carrierValue}
                onChange={(v) => setEditForm((f) => ({ ...f, carrier: v }))}
                clearable={false}
                size="sm"
              />
            </div>
            {isYamato ? (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">宅急便 完了</label>
                  <input
                    type="number"
                    min={0}
                    value={editForm.takuhaibin_completed ?? ""}
                    onChange={handleChange("takuhaibin_completed")}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">宅急便 持戻</label>
                  <input
                    type="number"
                    min={0}
                    value={editForm.takuhaibin_returned ?? ""}
                    onChange={handleChange("takuhaibin_returned")}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">ネコポス 完了</label>
                  <input
                    type="number"
                    min={0}
                    value={editForm.nekopos_completed ?? ""}
                    onChange={handleChange("nekopos_completed")}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">ネコポス 持戻</label>
                  <input
                    type="number"
                    min={0}
                    value={editForm.nekopos_returned ?? ""}
                    onChange={handleChange("nekopos_returned")}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded"
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-slate-600 mb-0.5">午前 持出</label>
                    <input
                      type="number"
                      min={0}
                      value={editForm.amazon_am_mochidashi ?? ""}
                      onChange={handleChange("amazon_am_mochidashi")}
                      className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-600 mb-0.5">午前 完了</label>
                    <input
                      type="number"
                      min={0}
                      value={editForm.amazon_am_completed ?? ""}
                      onChange={handleChange("amazon_am_completed")}
                      className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-slate-600 mb-0.5">午後 持出</label>
                    <input
                      type="number"
                      min={0}
                      value={editForm.amazon_pm_mochidashi ?? ""}
                      onChange={handleChange("amazon_pm_mochidashi")}
                      className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-600 mb-0.5">午後 完了</label>
                    <input
                      type="number"
                      min={0}
                      value={editForm.amazon_pm_completed ?? ""}
                      onChange={handleChange("amazon_pm_completed")}
                      className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-slate-600 mb-0.5">4便 持出</label>
                    <input
                      type="number"
                      min={0}
                      value={editForm.amazon_4_mochidashi ?? ""}
                      onChange={handleChange("amazon_4_mochidashi")}
                      className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-600 mb-0.5">4便 完了</label>
                    <input
                      type="number"
                      min={0}
                      value={editForm.amazon_4_completed ?? ""}
                      onChange={handleChange("amazon_4_completed")}
                      className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded"
                    />
                  </div>
                </div>
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
              onClick={onSave}
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

