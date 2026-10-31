"use client";
import type { ReactNode } from "react";
import { SelectionToggle } from "./SelectionToggle";
import { toggleShiftDisplay, type ShiftDisplay } from "@/lib/shiftDisplay";
import { cn } from "@/lib/ui/utils";

export function ShiftDisplayOptions({ value, onChange, axis, onAxisChange, children, soft = false }: {
  value: ShiftDisplay; onChange: (value: ShiftDisplay) => void;
  axis: "driver" | "course"; onAxisChange: (axis: "driver" | "course") => void;
  children?: ReactNode; soft?: boolean;
}) {
  return <div className={cn("flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg px-3 py-2", !soft && "border border-slate-200 bg-white")}>
    <div role="group" aria-label="表示する項目" className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-xs text-slate-500">表示項目</span>
      {([["shift", "シフト"], ["vehicle", "車両"], ["meetingTime", "集合時刻"]] as const).map(([key, label]) =>
        <SelectionToggle soft={soft} key={key} selected={value[key]} onClick={() => onChange(toggleShiftDisplay(value, key))}>{label}</SelectionToggle>)}
      <SelectionToggle soft={soft} selected={value.contract ?? value.vehicle} onClick={() => onChange(toggleShiftDisplay(value, "contract"))}>契約区分</SelectionToggle>
    </div>
    <div className="hidden items-center gap-2 md:flex">
      <span className="text-xs text-slate-500">並び</span>
      <div role="group" aria-label="表示の軸" className="flex overflow-hidden rounded-lg border border-slate-300">
        {([ ["driver", "ドライバー軸"], ["course", "コース軸"] ] as const).map(([key, label]) =>
          <button type="button" key={key} aria-pressed={axis === key} onClick={() => onAxisChange(key)} className={cn("px-3 py-2 text-xs font-semibold", key === "course" && "border-l border-slate-300", axis === key ? soft ? "bg-blue-50 text-blue-700 shadow-sm" : "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-50")}>{label}</button>)}
      </div>
    </div>
    {children}
  </div>;
}
