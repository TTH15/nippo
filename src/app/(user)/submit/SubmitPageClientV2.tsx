"use client";

import { useEffect, useMemo, useState } from "react";
import { Skeleton } from "@/lib/components/Skeleton";
import { DatePicker } from "@/lib/components/DatePicker";
import { apiFetch } from "@/lib/api";
import { reportDateDefaultJST, reportDateStrToDate, dateToReportDateStr } from "@/lib/date";

// ============================================================
// 動的日報フォーム（新モデル）。
//   その日のシフト(=コース)ごとに、キャリア配下の unit と報告項目を動的描画。
//   複数シフト（昼ヤマト＋夜Amazon等）は複数カードで表示し、まとめて送信。
//   送信は POST /api/reports/v2（daily_reports_v2 + report_entries）。
// 注: 旧 SubmitPageClient とは別ファイル。ルートは page.tsx で切替。
// ============================================================

type DriverIdentity = { id: string; slot: number; driverCode: string; officeCode: string; label?: string };
type Vehicle = { id: string; manufacturer?: string | null; brand?: string | null; number_numeric?: string | null; current_mileage?: number };

type FieldDef = {
  fieldKey: string;
  label: string;
  inputType: "INT" | "TEXT" | "TIME" | "BOOL";
  groupLabel: string | null;
  required: boolean;
};
type UnitDef = { id: string; name: string; code: string | null; billingType: "PER_PIECE" | "FIXED"; fields: FieldDef[] };
type ShiftForm = {
  courseId: string;
  courseName: string;
  color: string | null;
  carrierId: string | null;
  carrierName: string;
  units: UnitDef[];
  existing: { vehicleId: string | null; meterValue: number | null; values: Record<string, Record<string, number | string>> } | null;
};

// values[courseId][unitId][fieldKey] = string
type ValueMap = Record<string, Record<string, Record<string, string>>>;

export default function SubmitPageClientV2() {
  const [reportDate, setReportDate] = useState<Date>(() => reportDateStrToDate(reportDateDefaultJST()));
  const [identities, setIdentities] = useState<DriverIdentity[]>([]);
  const [selectedIdentityId, setSelectedIdentityId] = useState<string | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [meter, setMeter] = useState<string>("");

  const [shifts, setShifts] = useState<ShiftForm[]>([]);
  const [values, setValues] = useState<ValueMap>({});
  const [loading, setLoading] = useState(true);
  const [formLoading, setFormLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // プロフィール（勤務区分）・車両
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [profile, vehiclesRes] = await Promise.all([
          apiFetch<{ identities?: DriverIdentity[] }>("/api/reports/profile").catch(() => null),
          apiFetch<{ vehicles: Vehicle[] }>("/api/reports/vehicles", { cache: "no-store" }).catch(() => ({ vehicles: [] })),
        ]);
        const list = profile?.identities ?? [];
        setIdentities(list);
        if (list.length > 0) setSelectedIdentityId(list[0].id);
        setVehicles(vehiclesRes.vehicles ?? []);
        if ((vehiclesRes.vehicles ?? []).length > 0) setVehicleId(vehiclesRes.vehicles[0].id);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // 日付ごとの動的フォーム
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setFormLoading(true);
      try {
        const dateStr = dateToReportDateStr(reportDate);
        const res = await apiFetch<{ shifts: ShiftForm[] }>(`/api/me/report-form?date=${encodeURIComponent(dateStr)}`, { cache: "no-store" });
        if (cancelled) return;
        const list = res.shifts ?? [];
        setShifts(list);
        // 既存値で初期化
        const init: ValueMap = {};
        list.forEach((s) => {
          init[s.courseId] = {};
          s.units.forEach((u) => {
            init[s.courseId][u.id] = {};
            u.fields.forEach((f) => {
              const existing = s.existing?.values?.[u.id]?.[f.fieldKey];
              init[s.courseId][u.id][f.fieldKey] = existing != null ? String(existing) : "";
            });
          });
        });
        setValues(init);
        // 既存の車両/メーター（先頭シフト基準）
        const withExisting = list.find((s) => s.existing);
        if (withExisting?.existing) {
          if (withExisting.existing.vehicleId) setVehicleId(withExisting.existing.vehicleId);
          if (withExisting.existing.meterValue != null) setMeter(String(withExisting.existing.meterValue));
        }
      } catch {
        if (!cancelled) setShifts([]);
      } finally {
        if (!cancelled) setFormLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reportDate]);

  function setVal(courseId: string, unitId: string, fieldKey: string, v: string) {
    setValues((prev) => ({
      ...prev,
      [courseId]: { ...prev[courseId], [unitId]: { ...prev[courseId]?.[unitId], [fieldKey]: v } },
    }));
  }

  const meterNum = useMemo(() => (meter.trim() ? Number(meter) : null), [meter]);

  async function submit() {
    setSubmitting(true);
    setMessage(null);
    try {
      const items = shifts.map((s) => ({
        courseId: s.courseId,
        carrierId: s.carrierId,
        vehicleId,
        meterValue: meterNum,
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

      await apiFetch("/api/reports/v2", {
        method: "POST",
        body: JSON.stringify({
          reportDate: dateToReportDateStr(reportDate),
          driverIdentityId: selectedIdentityId,
          items,
        }),
      });
      setMessage({ kind: "ok", text: "日報を送信しました。" });
    } catch (e) {
      setMessage({ kind: "err", text: e instanceof Error ? e.message : "送信に失敗しました" });
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-md mx-auto px-4 py-6 space-y-3">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto px-4 py-6 space-y-5">
      <h1 className="text-lg font-semibold text-slate-900">日報入力</h1>

      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">日付</label>
          <DatePicker value={reportDate} onChange={(d) => d && setReportDate(d)} />
        </div>

        {identities.length > 1 && (
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">勤務区分</label>
            <select value={selectedIdentityId ?? ""} onChange={(e) => setSelectedIdentityId(e.target.value)} className="w-full px-2 py-2 border border-slate-300 rounded">
              {identities.map((i) => (
                <option key={i.id} value={i.id}>{i.label || i.driverCode}（{i.officeCode}）</option>
              ))}
            </select>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">車両</label>
            <select value={vehicleId ?? ""} onChange={(e) => setVehicleId(e.target.value || null)} className="w-full px-2 py-2 border border-slate-300 rounded">
              <option value="">未選択</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>{[v.manufacturer, v.brand, v.number_numeric].filter(Boolean).join(" ") || v.id.slice(0, 8)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">メーター(km)</label>
            <input type="number" value={meter} onChange={(e) => setMeter(e.target.value)} className="w-full px-2 py-2 border border-slate-300 rounded text-right" />
          </div>
        </div>
      </div>

      {formLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : shifts.length === 0 ? (
        <p className="text-sm text-slate-500 py-6 text-center">この日のシフトがありません。</p>
      ) : (
        <div className="space-y-4">
          {shifts.map((s) => (
            <div key={s.courseId} className="rounded-lg border border-slate-200 bg-white">
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-100">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: s.color ?? "#94a3b8" }} />
                <span className="font-medium text-slate-800">{s.courseName}</span>
                {s.carrierName && <span className="text-[11px] text-slate-400">{s.carrierName}</span>}
              </div>
              <div className="px-4 py-3 space-y-4">
                {s.units.length === 0 && <p className="text-xs text-slate-400">報告項目が設定されていません。</p>}
                {s.units.map((u) => (
                  <UnitFields key={u.id} unit={u} courseId={s.courseId} values={values} setVal={setVal} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {message && (
        <div className={`text-sm rounded px-3 py-2 ${message.kind === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>{message.text}</div>
      )}

      <button
        type="button"
        disabled={submitting || shifts.length === 0}
        onClick={submit}
        className="w-full py-3 rounded-lg bg-slate-900 text-white font-medium disabled:opacity-50"
      >
        {submitting ? "送信中…" : "送信"}
      </button>
    </div>
  );
}

function UnitFields({
  unit,
  courseId,
  values,
  setVal,
}: {
  unit: UnitDef;
  courseId: string;
  values: ValueMap;
  setVal: (courseId: string, unitId: string, fieldKey: string, v: string) => void;
}) {
  // group_label でグルーピング（null はグループなし）
  const groups = new Map<string, FieldDef[]>();
  unit.fields.forEach((f) => {
    const key = f.groupLabel ?? "";
    const arr = groups.get(key) ?? [];
    arr.push(f);
    groups.set(key, arr);
  });

  return (
    <div>
      <div className="text-sm font-medium text-slate-700 mb-1.5">{unit.name}</div>
      <div className="space-y-2">
        {Array.from(groups.entries()).map(([groupKey, fields]) => (
          <div key={groupKey}>
            {groupKey && <div className="text-[11px] text-indigo-600 mb-1">{groupKey}</div>}
            <div className="grid grid-cols-2 gap-2">
              {fields.map((f) => (
                <label key={f.fieldKey} className="block">
                  <span className="block text-[11px] text-slate-500 mb-0.5">{f.label}{f.required && <span className="text-red-500">*</span>}</span>
                  {f.inputType === "BOOL" ? (
                    <input
                      type="checkbox"
                      checked={(values[courseId]?.[unit.id]?.[f.fieldKey] ?? "") === "true"}
                      onChange={(e) => setVal(courseId, unit.id, f.fieldKey, e.target.checked ? "true" : "false")}
                    />
                  ) : (
                    <input
                      type={f.inputType === "INT" ? "number" : f.inputType === "TIME" ? "time" : "text"}
                      value={values[courseId]?.[unit.id]?.[f.fieldKey] ?? ""}
                      onChange={(e) => setVal(courseId, unit.id, f.fieldKey, e.target.value)}
                      className="w-full px-2 py-1.5 border border-slate-300 rounded text-right"
                    />
                  )}
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
