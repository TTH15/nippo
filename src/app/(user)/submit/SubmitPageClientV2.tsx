"use client";

import { useEffect, useMemo, useState } from "react";
import { Skeleton } from "@/lib/components/Skeleton";
import { DatePicker } from "@/lib/components/DatePicker";
import { VehiclePlate } from "@/lib/components/VehiclePlate";
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
type Vehicle = {
  id: string;
  manufacturer?: string | null;
  brand?: string | null;
  number_prefix?: string | null;
  number_class?: string | null;
  number_hiragana?: string | null;
  number_numeric?: string | null;
  current_mileage?: number;
  is_ev?: boolean;
};

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

        {/* 車両選択（カード式・横スクロール。旧フォーム同様） */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">使用車両</label>
          <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
            {vehicles.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => setVehicleId(v.id)}
                className={`flex-shrink-0 w-48 rounded-lg border bg-white px-1 pt-1 pb-2 transition-colors ${
                  vehicleId === v.id ? "border-slate-900" : "border-slate-200 hover:border-slate-400"
                }`}
              >
                <div className="w-[180px] mx-auto">
                  <VehiclePlate vehicle={v} selected={vehicleId === v.id} className="w-full max-w-[180px]" />
                </div>
              </button>
            ))}
            {/* 車両なしで続ける */}
            <button
              type="button"
              onClick={() => setVehicleId(null)}
              className={`flex-shrink-0 w-32 min-h-[3.5rem] rounded-lg border text-sm font-medium transition-colors ${
                vehicleId === null
                  ? "border-slate-900 bg-slate-50 text-slate-900"
                  : "border-dashed border-slate-300 text-slate-500 hover:border-slate-400"
              }`}
            >
              車両なしで
              <br />
              続ける
            </button>
          </div>
        </div>

        {/* メーター（車両選択あり & EV でない時のみ） */}
        {(() => {
          const sel = vehicles.find((v) => v.id === vehicleId) ?? null;
          if (!sel || sel.is_ev) return null;
          const prevKm = sel.current_mileage ?? 0;
          const placeholder = prevKm > 0 ? `前回: ${prevKm.toLocaleString("ja-JP")} km` : "例: 14567";
          const invalid = meter !== "" && prevKm > 0 && Number(meter) <= prevKm;
          return (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">メーター数値（km）</label>
              <input
                type="number"
                inputMode="numeric"
                min="0"
                placeholder={placeholder}
                value={meter}
                onChange={(e) => setMeter(e.target.value.replace(/\D/g, ""))}
                className={`w-full py-3 px-4 text-lg font-mono border rounded-xl focus:outline-none focus:ring-2 ${
                  invalid ? "border-red-400 focus:ring-red-200" : "border-slate-200 focus:ring-brand-500"
                }`}
              />
              {invalid && (
                <p className="mt-1 text-xs text-red-500">
                  前回（{prevKm.toLocaleString("ja-JP")} km）より大きい値を入力してください
                </p>
              )}
            </div>
          );
        })()}
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
            <div className="grid grid-cols-2 gap-3">
              {fields.map((f) => {
                const val = values[courseId]?.[unit.id]?.[f.fieldKey] ?? "";
                // BOOL: カード内トグル
                if (f.inputType === "BOOL") {
                  return (
                    <label
                      key={f.fieldKey}
                      className="flex items-center gap-2 bg-white rounded-xl border border-slate-200 p-4"
                    >
                      <input
                        type="checkbox"
                        checked={val === "true"}
                        onChange={(e) => setVal(courseId, unit.id, f.fieldKey, e.target.checked ? "true" : "false")}
                        className="h-5 w-5 accent-brand-700"
                      />
                      <span className="text-xs font-semibold text-slate-500">
                        {f.label}
                        {f.required && <span className="text-red-500 ml-0.5">*</span>}
                      </span>
                    </label>
                  );
                }
                // INT/TEXT/TIME: 旧フォーム同様のカード＋大きな数値入力
                const isInt = f.inputType === "INT";
                return (
                  <div key={f.fieldKey} className="bg-white rounded-xl border border-slate-200 p-4">
                    <label className="block text-xs font-semibold text-slate-500 mb-1">
                      {f.label}
                      {f.required && <span className="text-red-500 ml-0.5">*</span>}
                    </label>
                    <input
                      type={isInt ? "number" : f.inputType === "TIME" ? "time" : "text"}
                      inputMode={isInt ? "numeric" : undefined}
                      min={isInt ? "0" : undefined}
                      placeholder={isInt ? "0" : ""}
                      value={val}
                      onChange={(e) => setVal(courseId, unit.id, f.fieldKey, e.target.value)}
                      className={
                        isInt
                          ? "w-full text-3xl font-bold text-brand-900 py-2 border-0 focus:outline-none bg-transparent"
                          : "w-full text-lg text-slate-900 py-2 border-0 focus:outline-none bg-transparent"
                      }
                    />
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
