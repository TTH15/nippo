import { cellKey, resolveDayActivity, type DayOverride } from "./board";

export type ReflectCourse = { id: string; name: string; summary_title?: string | null; uses_cycles?: boolean | null; course_cycles?: { cycle_no: number; label?: string | null; active?: boolean | null }[] | null };
export type ReflectLane = { id: string; routeId: string; name: string; activeWeekdays: number[] };
export type ReflectPerson = { personKey: string; driverId?: string; name: string };
export type ReflectGroup = { date: string; courseId: string; cycleNo: number; driverIds: string[] };
export type ReflectInput = { mode: "add" | "replace"; groups: ReflectGroup[] };
export type ReflectChange = { date: string; courseId: string; cycleNo: number; addIds: string[]; removeIds: string[]; keepIds: string[] };
export type ReflectWarning = { date: string; driverId: string; courseName: string; kind: "other-course" | "off" };
export type ReflectPreview = { revision: string; changes: ReflectChange[]; warnings: ReflectWarning[]; added: number; removed: number; kept: number; applied: boolean };

export function laneCycleDefault(lane: ReflectLane, course: ReflectCourse): string {
  if (!course.uses_cycles) return "0";
  const cycle = course.course_cycles?.find(c => c.active !== false && lane.id === `base-${course.id}-${c.cycle_no}`);
  return cycle ? String(cycle.cycle_no) : "";
}

/** 名前で同一人物を推測しない。選択した枠と日だけを便別のドライバー集合へ変換する。 */
export function buildReflectGroups(input: {
  dates: string[]; lanes: ReflectLane[]; courses: ReflectCourse[]; selectedLaneIds: string[];
  assignments: Record<string, ReflectPerson[]>; dayOverrides: Record<string, DayOverride>;
  laneCycles: Record<string, string>; personMappings: Record<string, string>; driverIds: string[];
  includeEmpty: boolean;
}): { groups: ReflectGroup[]; errors: string[] } {
  const groups = new Map<string, ReflectGroup>();
  const errors = new Set<string>();
  const registered = new Set(input.driverIds);
  for (const lane of input.lanes.filter(l => input.selectedLaneIds.includes(l.id))) {
    const course = input.courses.find(c => c.id === lane.routeId);
    const selection = input.laneCycles[lane.id];
    const allowed = course?.uses_cycles ? (course.course_cycles ?? []).filter(c => c.active !== false).map(c => c.cycle_no) : [0];
    const cycles = selection === "all" ? allowed : selection !== undefined && selection !== "" ? [Number(selection)] : [];
    if (!course || !cycles.length || cycles.some(c => !allowed.includes(c))) {
      errors.add(`「${lane.name}」の反映先の便を選んでください。`);
      continue;
    }
    for (const date of input.dates) {
      const key = cellKey(lane.id, date);
      const active = resolveDayActivity(lane.activeWeekdays, new Date(`${date}T12:00:00`).getDay(), input.dayOverrides[key]).active;
      const people = input.assignments[key] ?? [];
      // 非稼働日に札が残っている場合は、黙って無視して本番を空にしない。
      if (!active && people.length) {
        errors.add(`${date.slice(5).replace("-", "/")}「${lane.name}」は休みの日に配置があります。メモを直してください。`);
        continue;
      }
      const driverIds = people.flatMap(person => {
        const driverId = input.personMappings[person.personKey] || person.driverId;
        if (!driverId || !registered.has(driverId)) {
          errors.add(`「${person.name}」の登録ドライバーを選んでください。`);
          return [];
        }
        return [driverId];
      });
      for (const cycleNo of cycles) {
        const groupKey = `${date}|${course.id}|${cycleNo}`;
        const previous = groups.get(groupKey);
        groups.set(groupKey, { date, courseId: course.id, cycleNo, driverIds: [...new Set([...(previous?.driverIds ?? []), ...driverIds])].sort() });
      }
    }
  }
  return { groups: [...groups.values()].filter(group => input.includeEmpty || group.driverIds.length > 0).sort((a, b) => `${a.date}|${a.courseId}|${a.cycleNo}`.localeCompare(`${b.date}|${b.courseId}|${b.cycleNo}`)), errors: [...errors] };
}
