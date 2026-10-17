/** 入力欄の振り分け・本人入力・日報照合で同じ便に同じ色を使う。 */
export function reportCycleTone(cycleNo: number) {
  const tones = [
    { border: "border-l-sky-500", surface: "bg-sky-50/60", badge: "border-sky-200 bg-sky-50 text-sky-800" },
    { border: "border-l-violet-500", surface: "bg-violet-50/60", badge: "border-violet-200 bg-violet-50 text-violet-800" },
    { border: "border-l-teal-500", surface: "bg-teal-50/60", badge: "border-teal-200 bg-teal-50 text-teal-800" },
    { border: "border-l-rose-500", surface: "bg-rose-50/60", badge: "border-rose-200 bg-rose-50 text-rose-800" },
  ];
  return cycleNo > 0 ? tones[(cycleNo - 1) % tones.length] : { border: "border-l-slate-300", surface: "bg-slate-50/60", badge: "border-slate-200 bg-slate-50 text-slate-700" };
}
