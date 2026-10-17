"use client";

import { useEffect, useImperativeHandle, useMemo, useRef, useState, forwardRef } from "react";
import { apiFetch } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { invalidateApi } from "@/lib/swr";
import { CustomSelect } from "@/lib/components/CustomSelect";
import { ReportFieldInputs } from "@/lib/components/ReportFieldInputs";
import { reportCycleTone, reportCycleTitle } from "@/lib/reportCycles";
import { useUnsavedChanges } from "@/lib/recordForms/useUnsavedChanges";
import { SmoothCollapse } from "@/lib/components/SmoothCollapse";

type FieldDef = { fieldKey: string; label: string; groupLabel: string | null; inputType: "INT" | "TEXT" | "TIME" | "BOOL" };
type UnitDef = { id: string; name: string; fields: FieldDef[] };
type Selected = { cycleNo: number; unitId: string; fieldKey: string };
type Payload = {
  usesCycles: boolean;
  cycles: { cycleNo: number; label: string | null }[];
  units: UnitDef[];
  selected: Selected[];
};
const keyOf = (cycle: number, unit: string, field: string) => `${cycle}:${unit}:${field}`;
const asRows = (keys: Set<string>) => [...keys].sort().map(k => {
  const [cycle, unit, ...field] = k.split(":");
  return { cycle_no: Number(cycle), unit_id: unit, field_key: field.join(":") };
});

export type CourseReportFieldsEditorHandle = { save: () => Promise<boolean> };
export const CourseReportFieldsEditor = forwardRef<CourseReportFieldsEditorHandle, {
  courseId: string | null;
  onError: (msg: string) => void;
  onDirty?: () => void;
  disabled?: boolean;
}>(function CourseReportFieldsEditor({ courseId, onError, onDirty, disabled = false }, ref) {
  const apiKey = courseId ? `/api/admin/course-report-fields?course_id=${courseId}` : null;
  const { data, error, isInitialLoading } = useApi<Payload>(apiKey, { revalidateOnFocus: false });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [original, setOriginal] = useState<Selected[]>([]);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  useUnsavedChanges(dirty);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const [message, setMessage] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const targets = useMemo(() => !data ? [] : data.usesCycles && data.cycles.length
    ? [...data.cycles].sort((a,b) => a.cycleNo - b.cycleNo).map(c => ({ cycleNo: c.cycleNo, label: c.label?.trim() || `C${c.cycleNo}` }))
    : [{ cycleNo: 0, label: "このコース" }], [data]);

  useEffect(() => {
    if (!data || !apiKey || loadedKey === apiKey) return;
    const keys = new Set(data.selected.filter(s => (s.cycleNo === 0 || targets.some(t => t.cycleNo === s.cycleNo)) &&
      data.units.some(u => u.id === s.unitId && u.fields.some(f => f.fieldKey === s.fieldKey)))
      .map(s => keyOf(s.cycleNo, s.unitId, s.fieldKey)));
    // DB と同じ「便固有 → 共通 → 全項目」の順で、実際に表示される項目を選択済みにする。
    for (const target of targets) {
      const exact = data.selected.filter(s => s.cycleNo === target.cycleNo);
      const common = data.selected.filter(s => s.cycleNo === 0);
      const effective = exact.length ? exact : common;
      for (const unit of data.units) for (const field of unit.fields) {
        if (!effective.length || effective.some(s => s.unitId === unit.id && s.fieldKey === field.fieldKey)) {
          keys.add(keyOf(target.cycleNo, unit.id, field.fieldKey));
        }
      }
    }
    setSelected(keys); setOriginal(data.selected); setLoadedKey(apiKey);
    setDirty(false); setMessage(""); setExpanded(new Set()); setDetailsOpen(false);
  }, [data, apiKey, loadedKey, targets]);

  const change = (next: Set<string>) => {
    if (disabled || saving) return;
    setSelected(next); setDirty(true); setMessage(""); onDirty?.();
  };
  const assign = (unit: UnitDef, fields: FieldDef[], value: string) => {
    if (value === "custom") return;
    const next = new Set(selected);
    const cycles = value === "all" ? targets.map(t => t.cycleNo) : value === "none" ? [] : value.split(",").map(Number);
    for (const field of fields) for (const target of targets) {
      const key = keyOf(target.cycleNo, unit.id, field.fieldKey);
      if (cycles.includes(target.cycleNo)) next.add(key); else next.delete(key);
    }
    change(next);
  };
  const assignmentValue = (unit: UnitDef, fields: FieldDef[]) => {
    const values = fields.map(f => targets.filter(t => selected.has(keyOf(t.cycleNo, unit.id, f.fieldKey))).map(t => t.cycleNo).join(",") || "none");
    return values.every(value => value === values[0]) ? values[0] : "custom";
  };
  const groups = (data?.units ?? []).flatMap(unit => [...new Set(unit.fields.map(f => f.groupLabel ?? ""))].map(group => ({
    key: JSON.stringify([unit.id, group]), unit, label: group || unit.name, fields: unit.fields.filter(f => (f.groupLabel ?? "") === group),
  })));
  const groupsFor = (cycleNo: number) => groups.filter(g => g.fields.some(f => selected.has(keyOf(cycleNo, g.unit.id, f.fieldKey))));
  const groupValue = (cycleNo: number) => {
    const active = groupsFor(cycleNo);
    return active.length === 0 ? "" : active.length === 1 && active[0].fields.every(f => selected.has(keyOf(cycleNo, active[0].unit.id, f.fieldKey))) ? active[0].key : "custom";
  };
  const selectGroup = (cycleNo: number, value: string) => {
    if (value === "custom") { setDetailsOpen(true); return; }
    const next = new Set(selected);
    for (const unit of data?.units ?? []) for (const field of unit.fields) next.delete(keyOf(cycleNo, unit.id, field.fieldKey));
    const group = groups.find(g => g.key === value);
    if (group) for (const field of group.fields) next.add(keyOf(cycleNo, group.unit.id, field.fieldKey));
    change(next);
  };
  const assignmentOptions = (value: string) => [
    { value: "none", label: "このコースでは使わない" },
    ...targets.map(t => ({ value: String(t.cycleNo), label: data?.usesCycles ? `${t.label}で使う` : "このコースで記録" })),
    ...(targets.length > 1 ? [{ value: targets.map(t => t.cycleNo).join(","), label: "全便で使う" }] : []),
    ...(value.includes(",") && value !== targets.map(t => t.cycleNo).join(",") ? [{ value, label: value.split(",").map(v => targets.find(t => t.cycleNo === Number(v))?.label ?? v).join("・") + "として記録" }] : []),
    { value: "custom", label: "項目ごとに指定" },
  ];
  const save = async () => {
    if (busy.current) return false;
    if (!courseId || !data || disabled || !dirty) return true;
    const emptyTarget = targets.find(t => data.units.some(u => u.fields.length) && !data.units.some(u => u.fields.some(f => selected.has(keyOf(t.cycleNo, u.id, f.fieldKey)))));
    if (emptyTarget) {
      setMessage(`${emptyTarget.label}に記録する入力欄を1つ以上選んでください。`); return false;
    }
    busy.current = true; setSaving(true); setMessage("");
    try {
      await apiFetch("/api/admin/course-report-fields", { method: "PUT", body: JSON.stringify({
        course_id: courseId, selected: asRows(selected),
        expected: original.map(s => ({ cycle_no: s.cycleNo, unit_id: s.unitId, field_key: s.fieldKey })),
      }) });
      setOriginal(asRows(selected).map(s => ({ cycleNo: s.cycle_no, unitId: s.unit_id, fieldKey: s.field_key })));
      setDirty(false); setMessage("保存しました"); void invalidateApi(apiKey!);
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "日報項目の保存に失敗しました";
      setMessage(msg); onError(msg); return false;
    } finally { busy.current = false; setSaving(false); }
  };

  useImperativeHandle(ref, () => ({ save }));

  if (!courseId) return <p className="py-8 text-center text-xs text-slate-500">先にコースを保存してください。</p>;
  if (isInitialLoading || (!error && loadedKey !== apiKey)) return <p className="py-10 text-center text-xs text-slate-400">読み込み中…</p>;
  if (error) return <div role="alert" className="p-4 text-sm text-red-700">日報項目を読み込めませんでした。<button type="button" className="ml-2 min-h-11 underline" onClick={() => void invalidateApi(apiKey!)}>再読み込み</button></div>;
  if (!data?.units.some(u => u.fields.length)) return <p className="py-8 text-center text-xs text-slate-500">キャリアの日報項目が未設定です。</p>;
  return <div className="space-y-4 text-sm">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="font-semibold text-slate-700">ドライバーの日報</span>
      <span className="text-xs text-slate-500">次の入力から適用</span>
    </div>
    {targets.map(target => {
      const active = groupsFor(target.cycleNo);
      const value = groupValue(target.cycleNo);
      const tone = reportCycleTone(target.cycleNo);
      const title = reportCycleTitle(target.cycleNo, target.label, active.map(g => g.label));
      return <section key={target.cycleNo} aria-label={title} className={`rounded-lg border p-3 space-y-3 ${tone.border} ${tone.surface}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-semibold text-slate-900">{title}</span>
          <div className="w-full sm:w-56"><CustomSelect ariaLabel={`${target.label}の入力欄`} value={value}
            options={[
              { value: "", label: "入力欄を選ぶ" },
              ...groups.map(g => ({ value: g.key, label: (data.units.length > 1 ? `${g.unit.name} / ` : "") + g.label })),
              ...(value === "custom" ? [{ value: "custom", label: "複数・個別の設定" }] : []),
            ]} clearable={false} disabled={disabled || saving} onChange={next => selectGroup(target.cycleNo, next)} /></div>
        </div>
        {active.map(g => <div key={g.key} className="space-y-2">
          {(active.length > 1 || data.units.length > 1) && <p className="text-xs font-medium text-slate-600">{g.label}</p>}
          <ReportFieldInputs fields={g.fields.filter(f => selected.has(keyOf(target.cycleNo, g.unit.id, f.fieldKey))).map(f => ({ ...f, required: false }))} valueFor={() => ""} onChange={() => {}} preview />
        </div>)}
      </section>;
    })}
    <button type="button" className="min-h-11 text-xs font-medium text-slate-600 underline underline-offset-2" aria-expanded={detailsOpen}
      aria-controls="course-report-details" onClick={() => setDetailsOpen(value => !value)}>詳細設定</button>
    <SmoothCollapse open={detailsOpen} id="course-report-details">
      <div className="space-y-3 border-t border-slate-200 pt-3">{groups.map((g,index) => {
        const value = assignmentValue(g.unit, g.fields);
        const open = expanded.has(g.key) || value === "custom";
        return <div key={g.key} className="rounded-lg border border-slate-200 p-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-700">{g.label}</span>
            <div className="w-full sm:w-56"><CustomSelect ariaLabel={`${g.label}を使う便`} value={value} options={assignmentOptions(value)} clearable={false} disabled={disabled || saving}
              onChange={next => { if(next === "custom") setExpanded(prev => new Set(prev).add(g.key)); else assign(g.unit, g.fields, next); }} /></div>
          </div>
          <SmoothCollapse open={open} id={`course-report-field-details-${index}`}>
            <div className="space-y-2 border-t border-slate-100 pt-2">{g.fields.map(f => {
              const fieldValue = assignmentValue(g.unit, [f]);
              return <div key={f.fieldKey} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] items-center gap-2">
                <span className="text-xs text-slate-600">{f.label}</span>
                <CustomSelect ariaLabel={`${g.label} ${f.label}を使う便`} value={fieldValue} options={assignmentOptions(fieldValue).filter(o => o.value !== "custom")}
                  clearable={false} disabled={disabled || saving} onChange={next => assign(g.unit, [f], next)} />
              </div>;
            })}</div>
          </SmoothCollapse>
        </div>;
      })}</div>
    </SmoothCollapse>
    {message && <p role={dirty ? "alert" : "status"} className={`text-xs ${dirty ? "text-red-700" : "text-slate-600"}`}>{message}</p>}
    {!disabled && <div className="flex justify-end"><button type="button" disabled={!dirty || saving} onClick={() => void save()}
      className="min-h-11 rounded-lg bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-40">{saving ? "保存中…" : "振り分けを保存"}</button></div>}
  </div>;
});
