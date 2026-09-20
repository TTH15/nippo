// ============================================================
// 画像から読み取った件数を、日報フォームの入力値へ入れる。
// 設計: docs/design/report-image-evidence-2026-09.md（RIMG-3）
//
// 値の行き先は「報告単位（unit）＋項目（field_key）」で決まる。その日のシフトが
// 複数あっても、その報告単位を持つシフトへ入れる。持つシフトが無ければ入れない
// （別のコースの件数を取り違えて入れない）。
// ============================================================
import { reportFormKey } from "./dailyReport";
import type { ShiftForm, ValueMap } from "../types";

export type ImageEntry = { unitId: string; fieldKey: string; value: number };

export type ApplyImageEntriesResult = {
  values: ValueMap;
  /** 入れた数 */
  applied: number;
  /** 行き先が無くて入れなかった項目 */
  skipped: ImageEntry[];
};

export function applyImageEntries(
  values: ValueMap,
  shifts: readonly ShiftForm[],
  entries: readonly ImageEntry[],
): ApplyImageEntriesResult {
  const next: ValueMap = { ...values };
  const skipped: ImageEntry[] = [];
  let applied = 0;

  for (const entry of entries) {
    // その報告単位と項目を実際に持っているシフトだけを行き先にする
    const shift = shifts.find((candidate) =>
      candidate.units.some(
        (unit) => unit.id === entry.unitId && unit.fields.some((field) => field.fieldKey === entry.fieldKey),
      ),
    );
    if (!shift) {
      skipped.push(entry);
      continue;
    }
    const formKey = reportFormKey(shift.courseId, shift.cycleNo ?? 0);
    next[formKey] = {
      ...next[formKey],
      [entry.unitId]: { ...next[formKey]?.[entry.unitId], [entry.fieldKey]: String(entry.value) },
    };
    applied += 1;
  }

  return { values: next, applied, skipped };
}
