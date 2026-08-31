import { cn } from "@/lib/ui/utils";
import { DAY_FILTER_LABELS, type DayCounts, type DayFilter } from "./dayFilter";

/** admin/(ops)/shifts/page.tsx の日別タブを一覧と画像保存で共用する。 */
export function DayFilterTabs({ value, counts, onChange, disabled = false }: { value: DayFilter; counts: DayCounts; onChange: (value: DayFilter) => void; disabled?: boolean }) {
  return <div role="group" aria-label="日別の表示対象" className="flex overflow-hidden rounded-lg border border-slate-300 bg-white">
    {(Object.keys(DAY_FILTER_LABELS) as DayFilter[]).map((id, i) => <button key={id} type="button" aria-pressed={value === id} disabled={disabled} onClick={() => onChange(id)} className={cn("flex-1 px-2 py-1.5 text-[13px] font-medium transition-colors disabled:opacity-50", i > 0 && "border-l border-slate-300", value === id ? "bg-slate-800 text-white" : "text-slate-600")}>
      {DAY_FILTER_LABELS[id]}<span className="ml-1 text-[11px] tabular-nums opacity-70">{counts[id]}</span>
    </button>)}
  </div>;
}
