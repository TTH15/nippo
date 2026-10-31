"use client";

import { motion, useReducedMotion } from "motion/react";
import { controlPopoverMotion, instantTransition } from "@/lib/ui/motion";
import { cn } from "@/lib/ui/utils";

export function ShiftPeriodControl({ year, month, value, onChange, compact = false }: {
  year: number; month: number; value: "first" | "second";
  onChange: (value: "first" | "second") => void;
  compact?: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const lastDay = new Date(year, month, 0).getDate();
  return <div role="group" aria-label="表示する半月" className={"shift-glass-control relative flex h-11 shrink-0 rounded-lg border border-slate-200 bg-white p-0.5"}>
    <motion.span aria-hidden className="pointer-events-none absolute bottom-0.5 left-0.5 top-0.5 w-[calc(50%-2px)] rounded-md border border-slate-800 bg-slate-800 shadow-sm"
      initial={false} animate={{ x: value === "first" ? "0%" : "100%" }}
      transition={reduceMotion ? instantTransition : { duration: controlPopoverMotion.duration, ease: controlPopoverMotion.ease }}/>
    {(["first", "second"] as const).map(period => {
      const label = period === "first" ? "前半" : "後半";
      const range = period === "first" ? "1〜15" : `16〜${lastDay}`;
      return <button key={period} type="button" onClick={() => onChange(period)} aria-pressed={value === period}
        aria-label={`${label}（${range}日）`}
        className={cn("relative z-10 flex items-center justify-center gap-1.5 rounded-md text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-500",compact ? "w-[48px]" : "w-[112px]", value === period ? "text-white" : "text-slate-600")}>
        {label}<span className={compact ? "hidden" : "text-[10px] font-normal"}>{range}日</span>
      </button>;
    })}
  </div>;
}
