"use client";

import { CustomSelect } from "./CustomSelect";
import { CheckboxField } from "./CheckboxField";
import { SHIFT_LEASE_NAMES, type ShiftLeaseFilter, type ShiftLeaseMode } from "@/lib/shiftLease";
import { cn } from "@/lib/ui/utils";
import { formatDateSlashWeekdayJP } from "@repo/core/logic/calendar";

// リースプレビューのShiftFiltersの契約欄を再利用。ラベル管理とは独立させる。
export function ShiftLeaseFilters({ value, onChange, grouped, onGroupedChange, ready, loading, onRetry, retrying, startDate, dailyDate, axis }: {
  value: ShiftLeaseFilter; onChange: (value: ShiftLeaseFilter) => void;
  grouped: boolean; onGroupedChange: (value: boolean) => void;
  ready: boolean; loading: boolean; onRetry: () => void; retrying: boolean;
  startDate: string; dailyDate: string; axis: "driver" | "course";
}) {
  return <section aria-label="契約区分" className={cn("w-full border-t border-slate-100 pt-2", axis === "course" && "md:hidden")}>
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
      <span className="text-xs font-medium text-slate-500">契約区分</span>
      <div className="min-w-[9rem] flex-1 sm:w-40 sm:flex-none">
        <CustomSelect ariaLabel="リース区分で絞り込み" value={value} onChange={value => onChange(value as ShiftLeaseFilter)} disabled={!ready} clearable={false} size="sm" triggerClassName="!h-11 !min-h-11 !rounded-lg !border !border-slate-200 !text-xs md:!h-9 md:!min-h-9" options={[{ value: "all", label: "すべての契約" }, ...Object.entries(SHIFT_LEASE_NAMES).map(([value, label]) => ({ value, label }))]} />
      </div>
      <CheckboxField label="契約区分でまとめる" checked={grouped} onCheckedChange={onGroupedChange} disabled={!ready} className="shrink-0 whitespace-nowrap [&>span]:h-11 [&>span]:gap-2 [&>span]:px-2.5 [&>span]:py-0 [&>span]:text-xs md:[&>span]:h-9 md:[&>span]:min-h-9" />
      <span className="text-[11px] text-slate-500"><span className="hidden md:inline">{formatDateSlashWeekdayJP(startDate)} 時点</span><span className="md:hidden">{formatDateSlashWeekdayJP(dailyDate)} 時点</span></span>
    </div>
    {!ready && <p role={loading ? "status" : "alert"} className="mt-1 text-xs text-amber-800">
      {loading ? "契約区分を読み込み中…" : <>契約区分を取得できませんでした。シフトは表示しています。<button type="button" disabled={retrying} onClick={onRetry} className="ml-2 min-h-11 underline disabled:opacity-50">{retrying ? "再読み込み中…" : "再読み込み"}</button></>}
    </p>}
  </section>;
}

export function ShiftLeaseBadge({ mode }: { mode: ShiftLeaseMode | null }) {
  return <span className="inline-block rounded border border-slate-200 bg-slate-50 px-1 py-0.5 text-[10px] font-normal leading-tight text-slate-600">{mode ? SHIFT_LEASE_NAMES[mode] : "契約区分未取得"}</span>;
}
