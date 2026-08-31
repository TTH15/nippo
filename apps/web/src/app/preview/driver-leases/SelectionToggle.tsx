"use client";
import type { ReactNode } from "react";
import { cn } from "@/lib/ui/utils";

// 選択は面の色で示し、チェック用の領域を確保しない。
export function SelectionToggle({ selected, onClick, children, title, compact = false }: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
  title?: string;
  compact?: boolean;
}) {
  return <button type="button" aria-pressed={selected} onClick={onClick} title={title}
    className={cn("inline-flex items-center justify-center rounded-full border px-3 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400", compact ? "max-w-full min-h-8 break-all py-1 md:min-h-9" : "min-h-11 sm:min-h-9", selected ? "border-slate-800 bg-slate-800 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50")}>
    {children}
  </button>;
}
