/** 入力欄の振り分け・本人入力・日報照合で同じ便に同じ色を使う。 */
export function reportCycleTone(cycleNo: number) {
  const tones = [
    { border: "border-sky-200", surface: "bg-sky-100", badge: "border-sky-200 bg-sky-50 text-sky-800" },
    { border: "border-violet-200", surface: "bg-violet-100", badge: "border-violet-200 bg-violet-50 text-violet-800" },
    { border: "border-teal-200", surface: "bg-teal-100", badge: "border-teal-200 bg-teal-50 text-teal-800" },
    { border: "border-rose-200", surface: "bg-rose-100", badge: "border-rose-200 bg-rose-50 text-rose-800" },
  ];
  return cycleNo > 0 ? tones[(cycleNo - 1) % tones.length] : { border: "border-slate-200", surface: "bg-slate-50", badge: "border-slate-200 bg-slate-50 text-slate-700" };
}

/** コースの並びを保ち、同じコースの便は番号順にまとめる。 */
export function orderCourseCycles<T>(items: readonly T[], course: (item: T) => string, cycle: (item: T) => number): T[] {
  const ranks = new Map<string, number>();
  for (const item of items) if (!ranks.has(course(item))) ranks.set(course(item), ranks.size);
  return [...items].sort((a, b) => ranks.get(course(a))! - ranks.get(course(b))! || cycle(a) - cycle(b));
}

export function reportCycleTitle(cycleNo: number, label: string | null | undefined, groups: readonly (string | null | undefined)[]): string {
  const name = label?.trim() || (cycleNo ? `C${cycleNo}` : "このコース");
  const unique = [...new Set(groups.map(group => group?.trim()).filter((group): group is string => !!group))];
  return unique.length === 1 && unique[0] !== name && !name.includes(unique[0]) ? `${name}（${unique[0]}）` : name;
}
