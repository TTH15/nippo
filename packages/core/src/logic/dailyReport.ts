// 日報フォーム（新モデル / submit-v2）のドメインロジック（純粋・プラットフォーム非依存）。
// 送信payloadの構築は送信データの整合性に直結するため、ここに集約してテストで固定する。
import type {
  ShiftForm,
  ValueMap,
  FieldDef,
  ReportItem,
  SubmitVehicle,
} from "../types";

/** コース内のC1/C2を別フォームとして保持するための安定キー。 */
export function reportFormKey(courseId: string, cycleNo = 0): string {
  return cycleNo > 0 ? `${courseId}:${cycleNo}` : courseId;
}

export type ReportCycleChoice = { courseId: string; cycleNo: number };

/**
 * 旧cycle_no=0日報が残る日は、編集時にC1/C2を新規作成して二重計上しないよう
 * コース全体の1フォームへ畳む。新規日付や便別日報がある日は便別のまま返す。
 */
export function resolveReportCycleChoices(
  shiftChoices: ReportCycleChoice[],
  existingChoices: ReportCycleChoice[],
): ReportCycleChoice[] {
  const existingByCourse = new Map<string, Set<number>>();
  for (const choice of existingChoices) {
    const cycles = existingByCourse.get(choice.courseId) ?? new Set<number>();
    cycles.add(choice.cycleNo);
    existingByCourse.set(choice.courseId, cycles);
  }

  // サイクル導入前の「全体」枠(cycle_no=0)が便別シフトと一緒に残っていると、
  // 同じ日に3本（全体・C1・C2）提出できてしまい日当が二重計上される。
  // 便を明示した枠がある コースでは、旧「全体」枠を候補から外す。
  const perCycleCourses = new Set(
    shiftChoices.filter((choice) => choice.cycleNo > 0).map((choice) => choice.courseId),
  );
  const activeChoices = shiftChoices.filter(
    (choice) => !(choice.cycleNo === 0 && perCycleCourses.has(choice.courseId)),
  );

  const collapsedCourses = new Set<string>();
  const result: ReportCycleChoice[] = [];
  for (const choice of activeChoices) {
    const existingCycles = existingByCourse.get(choice.courseId);
    const legacyOnly = existingCycles?.has(0) && ![...existingCycles].some((cycleNo) => cycleNo > 0);
    if (legacyOnly) {
      if (!collapsedCourses.has(choice.courseId)) {
        result.push({ courseId: choice.courseId, cycleNo: 0 });
        collapsedCourses.add(choice.courseId);
      }
    } else {
      result.push(choice);
    }
  }
  return result;
}

/** その日のシフト群から、既存reportの値で初期化した入力マップを構築（未入力は ""）。 */
export function buildInitialValues(shifts: ShiftForm[]): ValueMap {
  const init: ValueMap = {};
  shifts.forEach((s) => {
    const formKey = reportFormKey(s.courseId, s.cycleNo);
    init[formKey] = {};
    s.units.forEach((u) => {
      init[formKey][u.id] = {};
      u.fields.forEach((f) => {
        const existing = s.existing?.values?.[u.id]?.[f.fieldKey];
        init[formKey][u.id][f.fieldKey] = existing != null ? String(existing) : "";
      });
    });
  });
  return init;
}

/** メーター入力文字列を数値化する（空白のみ・空文字なら null）。 */
export function parseMeter(meter: string): number | null {
  return meter.trim() ? Number(meter) : null;
}

/**
 * 既定の使用車両ID。
 * その日のシフト割当車両を最優先 > 既存reportの車両 > null。
 */
export function resolveDefaultVehicleId(
  shifts: ShiftForm[],
  shiftVehicleId: string | null,
): string | null {
  const existingVid = shifts.find((s) => s.existing)?.existing?.vehicleId ?? null;
  return shiftVehicleId || existingVid || null;
}

/** 既存reportのメーター値（文字列。無ければ ""）。 */
export function resolveExistingMeter(shifts: ShiftForm[]): string {
  const meterValue = shifts.find((s) => s.existing)?.existing?.meterValue;
  return meterValue != null ? String(meterValue) : "";
}

/** 紐付け車両＋未紐付け車両から id で1台検索（見つからなければ null）。 */
export function findVehicle(
  vehicles: SubmitVehicle[],
  unlinked: SubmitVehicle[],
  id: string | null,
): SubmitVehicle | null {
  if (!id) return null;
  return [...vehicles, ...unlinked].find((v) => v.id === id) ?? null;
}

/**
 * 送信payloadの items を構築する。
 * INT フィールドは valueNum（空は0）、それ以外は valueText に入れる。
 * vehicleId / meterValue は全シフト共通で適用。
 */
export function buildReportItems(
  shifts: ShiftForm[],
  values: ValueMap,
  vehicleId: string | null,
  meterValue: number | null,
): ReportItem[] {
  return shifts.map((s) => ({
    courseId: s.courseId,
    cycleNo: s.cycleNo ?? 0,
    carrierId: s.carrierId,
    vehicleId,
    meterValue,
    entries: s.units.flatMap((u) =>
      u.fields.map((f) => {
        const raw = values[reportFormKey(s.courseId, s.cycleNo)]?.[u.id]?.[f.fieldKey] ?? "";
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
}

/**
 * 車両カードの並びを決める。
 * 紐付け車両 → 選択中の未紐付け車両 →（展開時）その他未紐付け車両、の順に積み、
 * その日のシフト割当車両があれば先頭にサジェスト（重複排除）。
 */
export function buildVehicleCards(args: {
  vehicles: SubmitVehicle[];
  unlinked: SubmitVehicle[];
  vehicleId: string | null;
  shiftVehicleId: string | null;
  showOtherVehicles: boolean;
}): { cards: SubmitVehicle[]; linkedIds: Set<string>; hasMoreOthers: boolean } {
  const { vehicles, unlinked, vehicleId, shiftVehicleId, showOtherVehicles } = args;
  const allById = new Map<string, SubmitVehicle>(
    [...vehicles, ...unlinked].map((v) => [v.id, v]),
  );
  const linkedIds = new Set(vehicles.map((v) => v.id));
  const cards: SubmitVehicle[] = [...vehicles];

  const sel = vehicleId ? allById.get(vehicleId) : null;
  if (sel && !linkedIds.has(sel.id)) cards.push(sel);

  if (showOtherVehicles) {
    for (const v of unlinked) {
      if (!cards.some((c) => c.id === v.id)) cards.push(v);
    }
  }

  const shiftVehicle = shiftVehicleId ? allById.get(shiftVehicleId) : null;
  if (shiftVehicle) {
    if (!cards.some((c) => c.id === shiftVehicle.id)) cards.push(shiftVehicle);
    const idx = cards.findIndex((c) => c.id === shiftVehicle.id);
    if (idx > 0) {
      const [moved] = cards.splice(idx, 1);
      cards.unshift(moved);
    }
  }

  const hasMoreOthers = unlinked.some((v) => !cards.some((c) => c.id === v.id));
  return { cards, linkedIds, hasMoreOthers };
}

/** unit のフィールドを group_label でグルーピングする（null は "" キー、挿入順を維持）。 */
export function groupFieldsByLabel(fields: FieldDef[]): [string, FieldDef[]][] {
  const groups = new Map<string, FieldDef[]>();
  fields.forEach((f) => {
    const key = f.groupLabel ?? "";
    const arr = groups.get(key) ?? [];
    arr.push(f);
    groups.set(key, arr);
  });
  return Array.from(groups.entries());
}
