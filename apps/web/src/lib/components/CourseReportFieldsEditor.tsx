"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { invalidateApi } from "@/lib/swr";

// ============================================================
// コース（＋便）ごとに日報で使う入力項目を選ぶ。
// 報告項目はキャリア配下の unit に付くが、実際に使う項目はコースで違う
// （Amazon配送は午前/午後/4便の6項目だが、上鳥羽のC1は午前だけ使う）。
// 何も選ばなければ全項目を使う（既定・後方互換）。
// ============================================================

type FieldDef = { fieldKey: string; label: string; groupLabel: string | null; inputType: string };
type UnitDef = { id: string; name: string; fields: FieldDef[] };
type Selected = { cycleNo: number; unitId: string; fieldKey: string };
type Payload = {
  usesCycles: boolean;
  cycles: { cycleNo: number; label: string | null }[];
  units: UnitDef[];
  selected: Selected[];
};

const keyOf = (cycleNo: number, unitId: string, fieldKey: string) => `${cycleNo}:${unitId}:${fieldKey}`;

export function CourseReportFieldsEditor({ courseId, onError, onDirty }: {
  courseId: string | null;
  onError: (msg: string) => void;
  onDirty?: () => void;
}) {
  const apiKey = courseId ? `/api/admin/course-report-fields?course_id=${courseId}` : null;
  const { data, error, isInitialLoading } = useApi<Payload>(apiKey, { revalidateOnFocus: false });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);

  useEffect(() => { setLoaded(false); }, [apiKey]);
  useEffect(() => {
    if (!data || loaded) return;
    setSelected(new Set(data.selected.map((s) => keyOf(s.cycleNo, s.unitId, s.fieldKey))));
    setLoaded(true);
  }, [data, loaded]);
  useEffect(() => {
    if (error) onError(error instanceof Error ? error.message : "入力項目の読み込みに失敗しました");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error]);

  // 便を使うコースは便ごと、使わないコースはコース共通(0)の1枠だけ
  const targets = useMemo(() => {
    if (!data) return [] as { cycleNo: number; label: string }[];
    if (data.usesCycles && data.cycles.length) {
      return data.cycles.map((c) => ({ cycleNo: c.cycleNo, label: c.label?.trim() || `C${c.cycleNo}` }));
    }
    return [{ cycleNo: 0, label: "この コース" }];
  }, [data]);

  const save = async (next: Set<string>) => {
    if (!courseId) return;
    const payload = [...next].map((k) => {
      const [cycleNo, unitId, ...rest] = k.split(":");
      return { cycle_no: Number(cycleNo), unit_id: unitId, field_key: rest.join(":") };
    });
    try {
      await apiFetch("/api/admin/course-report-fields", {
        method: "PUT",
        body: JSON.stringify({ course_id: courseId, selected: payload }),
      });
      void invalidateApi(apiKey!);
    } catch (e) {
      onError(e instanceof Error ? e.message : "入力項目の保存に失敗しました");
    }
  };

  const toggle = (cycleNo: number, unitId: string, fieldKey: string) => {
    onDirty?.();
    setSelected((prev) => {
      const next = new Set(prev);
      const k = keyOf(cycleNo, unitId, fieldKey);
      if (next.has(k)) next.delete(k); else next.add(k);
      void save(next);
      return next;
    });
  };

  const toggleGroup = (cycleNo: number, unit: UnitDef, groupLabel: string | null, on: boolean) => {
    onDirty?.();
    setSelected((prev) => {
      const next = new Set(prev);
      unit.fields.filter((f) => (f.groupLabel ?? null) === groupLabel).forEach((f) => {
        const k = keyOf(cycleNo, unit.id, f.fieldKey);
        if (on) next.add(k); else next.delete(k);
      });
      void save(next);
      return next;
    });
  };

  if (!courseId) {
    return <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-8 text-center text-xs text-slate-500">コースを保存すると設定できます。</div>;
  }
  if (isInitialLoading) return <p className="py-10 text-center text-xs text-slate-400">読み込み中…</p>;
  if (!data?.units.length) {
    return <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-xs text-slate-400">キャリアを設定すると項目を選べます。</div>;
  }

  const noneSelected = selected.size === 0;

  return (
    <div className="space-y-4 text-sm">
      <div className={`rounded-lg border px-3 py-2 text-xs ${noneSelected ? "border-slate-200 bg-slate-50 text-slate-500" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
        {noneSelected
          ? "未選択のときは、キャリアの全項目を日報に出します。"
          : "選んだ項目だけを日報の入力欄と一覧に出します。"}
      </div>

      {targets.map((t) => (
        <section key={t.cycleNo} className="rounded-xl border border-slate-200 bg-white p-3">
          {data.usesCycles && <div className="mb-2 text-xs font-semibold text-slate-600">{t.label}</div>}
          <div className="space-y-3">
            {data.units.map((unit) => {
              const groups = Array.from(new Set(unit.fields.map((f) => f.groupLabel ?? null)));
              return (
                <div key={unit.id} className="space-y-2">
                  <div className="text-xs font-medium text-slate-700">{unit.name}</div>
                  {groups.map((g) => {
                    const fields = unit.fields.filter((f) => (f.groupLabel ?? null) === g);
                    const allOn = fields.every((f) => selected.has(keyOf(t.cycleNo, unit.id, f.fieldKey)));
                    return (
                      <div key={g ?? "_"} className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2">
                        {g && (
                          <label className="mb-1.5 flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-600">
                            <input type="checkbox" checked={allOn}
                              onChange={(e) => toggleGroup(t.cycleNo, unit, g, e.target.checked)}
                              className="h-3.5 w-3.5 rounded border-slate-300 accent-slate-800" />
                            {g}
                          </label>
                        )}
                        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                          {fields.map((f) => (
                            <label key={f.fieldKey} className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-600">
                              <input type="checkbox"
                                checked={selected.has(keyOf(t.cycleNo, unit.id, f.fieldKey))}
                                onChange={() => toggle(t.cycleNo, unit.id, f.fieldKey)}
                                className="h-3.5 w-3.5 rounded border-slate-300 accent-slate-800" />
                              {f.label}
                            </label>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
