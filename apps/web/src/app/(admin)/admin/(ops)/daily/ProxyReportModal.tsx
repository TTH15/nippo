"use client";

// 運営の代理入力モーダル。
//   未提出のドライバー・日付について、運営が個数を入力して日報を作成する。
//   動的フォーム（/api/admin/daily/report-form）でキャリア配下の unit/field を取得し、
//   保存（/api/admin/daily/reports/proxy）すると承認済みとして集計に反映される。

import { useCallback, useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTriangleExclamation } from "@fortawesome/free-solid-svg-icons";
import { apiFetch } from "@/lib/api";
import { Skeleton } from "@/lib/components/Skeleton";

type Field = {
  fieldKey: string;
  label: string;
  inputType: "INT" | "TEXT" | "TIME" | "BOOL";
  groupLabel: string | null;
  required: boolean;
  sortOrder: number;
};
type Unit = { id: string; name: string; code: string; billingType: string; fields: Field[] };
type ShiftForm = {
  courseId: string;
  courseName: string;
  color: string | null;
  carrierId: string | null;
  carrierName: string;
  units: Unit[];
  existing: {
    reportId: string;
    vehicleId: string | null;
    meterValue: number | null;
    values: Record<string, Record<string, number | string>>;
  } | null;
};

type Target = { driverId: string; driverName: string; date: string };

// values[courseId][unitId][fieldKey] = string
type Values = Record<string, Record<string, Record<string, string>>>;

interface ProxyReportModalProps {
  target: Target | null;
  onClose: () => void;
  onSaved: () => void;
}

export default function ProxyReportModal({ target, onClose, onSaved }: ProxyReportModalProps) {
  const [shifts, setShifts] = useState<ShiftForm[]>([]);
  const [shiftVehicleId, setShiftVehicleId] = useState<string | null>(null);
  const [values, setValues] = useState<Values>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fmtDate = (d: string) => {
    const [y, m, day] = d.split("-");
    return `${y}年${parseInt(m, 10)}月${parseInt(day, 10)}日`;
  };

  const load = useCallback(async (t: Target) => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ shifts: ShiftForm[]; shiftVehicleId: string | null }>(
        `/api/admin/daily/report-form?driverId=${encodeURIComponent(t.driverId)}&date=${encodeURIComponent(t.date)}`,
      );
      const loaded = res.shifts ?? [];
      setShifts(loaded);
      setShiftVehicleId(res.shiftVehicleId ?? null);
      // 既存値を prefill
      const init: Values = {};
      loaded.forEach((s) => {
        init[s.courseId] = {};
        s.units.forEach((u) => {
          init[s.courseId][u.id] = {};
          u.fields.forEach((f) => {
            const ev = s.existing?.values?.[u.id]?.[f.fieldKey];
            init[s.courseId][u.id][f.fieldKey] = ev != null ? String(ev) : "";
          });
        });
      });
      setValues(init);
    } catch (e) {
      setError(e instanceof Error ? e.message : "フォームの取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (target) load(target);
    else {
      setShifts([]);
      setValues({});
      setError(null);
    }
  }, [target, load]);

  if (!target) return null;

  const setVal = (courseId: string, unitId: string, fieldKey: string, v: string) =>
    setValues((prev) => ({
      ...prev,
      [courseId]: {
        ...prev[courseId],
        [unitId]: { ...prev[courseId]?.[unitId], [fieldKey]: v },
      },
    }));

  const hasFields = shifts.some((s) => s.units.some((u) => u.fields.length > 0));

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const items = shifts.map((s) => ({
        courseId: s.courseId,
        carrierId: s.carrierId,
        vehicleId: s.existing?.vehicleId ?? shiftVehicleId,
        meterValue: s.existing?.meterValue ?? null,
        entries: s.units.flatMap((u) =>
          u.fields.map((f) => {
            const raw = values[s.courseId]?.[u.id]?.[f.fieldKey] ?? "";
            const isNumeric = f.inputType === "INT";
            return {
              unitId: u.id,
              fieldKey: f.fieldKey,
              valueNum: isNumeric ? (raw.trim() ? Number(raw) : 0) : null,
              valueText: isNumeric ? null : raw,
            };
          }),
        ),
      }));
      await apiFetch("/api/admin/daily/reports/proxy", {
        method: "POST",
        body: JSON.stringify({ driverId: target.driverId, reportDate: target.date, items }),
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-lg w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-1">
            代理入力 — {target.driverName}
          </h2>
          <p className="text-xs text-slate-500 mb-4">
            {fmtDate(target.date)} のシフトに基づいて個数を入力します。保存すると承認済みの日報として作成され、売上・報酬・集計に反映されます。
          </p>

          {error && (
            <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 flex items-start gap-2">
              <FontAwesomeIcon icon={faTriangleExclamation} className="mt-0.5 text-rose-500" />
              <span>{error}</span>
            </div>
          )}

          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : shifts.length === 0 ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800">
              この日のシフトが見つかりません。先にシフト画面でコースとドライバーを割り当ててください。
            </div>
          ) : !hasFields ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800">
              このコースのキャリアに報告項目（ユニット/フィールド）が設定されていません。キャリア管理画面でユニットと個数フィールドを設定してください。
            </div>
          ) : (
            <div className="space-y-5">
              {shifts.map((s) => (
                <div key={s.courseId} className="rounded-lg border border-slate-200">
                  <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50 rounded-t-lg flex items-center gap-2">
                    {s.color && (
                      <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: s.color }} />
                    )}
                    <span className="text-sm font-semibold text-slate-800">{s.courseName}</span>
                    {s.carrierName && (
                      <span className="text-[11px] text-slate-500">/ {s.carrierName}</span>
                    )}
                  </div>
                  <div className="p-4 space-y-4">
                    {s.units.length === 0 || s.units.every((u) => u.fields.length === 0) ? (
                      <p className="text-xs text-slate-400">報告項目が未設定です。</p>
                    ) : (
                      s.units.map((u) => (
                        <div key={u.id}>
                          <div className="text-xs font-semibold text-slate-600 mb-2">{u.name}</div>
                          <div className="grid grid-cols-2 gap-3">
                            {u.fields.map((f) => {
                              const val = values[s.courseId]?.[u.id]?.[f.fieldKey] ?? "";
                              if (f.inputType === "BOOL") {
                                return (
                                  <label
                                    key={f.fieldKey}
                                    className="flex items-center gap-2 rounded border border-slate-200 px-3 py-2"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={val === "true"}
                                      onChange={(e) => setVal(s.courseId, u.id, f.fieldKey, e.target.checked ? "true" : "false")}
                                      className="h-4 w-4 accent-slate-800"
                                    />
                                    <span className="text-xs text-slate-700">
                                      {f.label}
                                      {f.required && <span className="text-red-500 ml-0.5">*</span>}
                                    </span>
                                  </label>
                                );
                              }
                              const isInt = f.inputType === "INT";
                              return (
                                <div key={f.fieldKey}>
                                  <label className="block text-xs font-medium text-slate-600 mb-1">
                                    {f.label}
                                    {f.required && <span className="text-red-500 ml-0.5">*</span>}
                                  </label>
                                  <input
                                    type={isInt ? "number" : f.inputType === "TIME" ? "time" : "text"}
                                    inputMode={isInt ? "numeric" : undefined}
                                    min={isInt ? 0 : undefined}
                                    placeholder={isInt ? "0" : ""}
                                    value={val}
                                    onChange={(e) => setVal(s.courseId, u.id, f.fieldKey, e.target.value)}
                                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded"
                                  />
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

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
              onClick={save}
              disabled={saving || loading || !hasFields}
              className="px-4 py-1.5 bg-slate-800 text-white text-sm font-medium rounded hover:bg-slate-700 disabled:opacity-50"
            >
              {saving ? "保存中..." : "保存して承認"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
