import { reportFormKey } from "./dailyReport";
import type { ShiftForm, ValueMap } from "../types";

export type ImageEntry = { unitId: string; fieldKey: string; value: number; targetFormKey?: string };
export type ApplyImageEntriesResult = { values: ValueMap; applied: number; skipped: ImageEntry[] };

/** 項目が実在する行き先だけを返す。同じ項目を持つ別コースを先頭順で選ばない。 */
export function imageEntryTargets(shifts: readonly ShiftForm[], entry: Pick<ImageEntry,"unitId"|"fieldKey">): ShiftForm[] {
  return [...new Map(shifts.filter(candidate => candidate.units.some(unit => unit.id === entry.unitId && unit.fields.some(field => field.fieldKey === entry.fieldKey)))
    .map(shift => [reportFormKey(shift.courseId, shift.cycleNo ?? 0),shift])).values()];
}

export function applyImageEntries(values: ValueMap, shifts: readonly ShiftForm[], entries: readonly ImageEntry[]): ApplyImageEntriesResult {
  const next: ValueMap = { ...values };
  const skipped: ImageEntry[] = [];
  let applied = 0;
  const routed = entries.map(entry => {
    const candidates = imageEntryTargets(shifts,entry);
    const shift = entry.targetFormKey ? candidates.find(candidate => reportFormKey(candidate.courseId,candidate.cycleNo ?? 0) === entry.targetFormKey) : candidates.length === 1 ? candidates[0] : undefined;
    const formKey = shift ? reportFormKey(shift.courseId,shift.cycleNo ?? 0) : null;
    return { entry,formKey,key: JSON.stringify([formKey,entry.unitId,entry.fieldKey]) };
  });
  const valuesByKey = new Map<string,Set<number>>();
  for (const row of routed) if(row.formKey) valuesByKey.set(row.key,new Set([...(valuesByKey.get(row.key) ?? []),row.entry.value]));
  const seen = new Set<string>();
  for (const {entry,formKey,key} of routed) {
    if (!formKey || !Number.isFinite(entry.value) || entry.value < 0 || (valuesByKey.get(key)?.size ?? 0) > 1) { skipped.push(entry);continue; }
    if(seen.has(key)) continue;
    seen.add(key);
    next[formKey] = { ...next[formKey], [entry.unitId]: { ...next[formKey]?.[entry.unitId], [entry.fieldKey]: String(entry.value) } };
    applied += 1;
  }
  return { values: next, applied, skipped };
}
