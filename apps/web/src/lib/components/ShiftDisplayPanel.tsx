"use client";

import { useId, useState, type ReactNode } from "react";
import { useReducedMotion } from "motion/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronDown, faSliders, faXmark } from "@fortawesome/free-solid-svg-icons";
import { Popover, PopoverTrigger, PopoverContent } from "@/lib/ui/popover";
import { controlPopoverMotion } from "@/lib/ui/motion";
import { cn } from "@/lib/ui/utils";

/** 開閉を局所化し、表の位置・幅を変えずに設定を重ねる。 */
export function ShiftDisplayPanel({ toolbar, children }: {
  toolbar: (trigger: ReactNode) => ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const reduceMotion = useReducedMotion();
  const id = useId();
  const triggerId = `${id}-toggle`;
  return <Popover open={open} onOpenChange={setOpen}>
      <style>{`@media (prefers-reduced-transparency: reduce) { .shift-glass-control { backdrop-filter:none!important; background-color:#fff!important; } } @media (prefers-reduced-motion: reduce) { .shift-display-content { --shift-display-scale: 1 !important; } } @keyframes shift-display-in { from { opacity:0; transform:scale(var(--shift-display-scale)); } to { opacity:1; transform:scale(1); } }
        @keyframes shift-display-out { from { opacity:1; transform:scale(1); } to { opacity:0; transform:scale(var(--shift-display-scale)); } }`}</style>
    {toolbar(<PopoverTrigger asChild><button type="button" id={triggerId} className={cn("shift-glass-control inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border px-3 text-xs backdrop-blur-sm", open ? "border-blue-200 bg-blue-50/90 text-blue-700" : "border-slate-300 bg-white/90 text-slate-600 hover:bg-slate-50")}>
      <FontAwesomeIcon icon={faSliders}/>表示<FontAwesomeIcon icon={faChevronDown} rotation={open ? 180 : undefined}/>
    </button></PopoverTrigger>)}
    <PopoverContent align="end" side="bottom" sideOffset={6} aria-labelledby={triggerId}
      className="shift-display-content w-[380px] max-w-[calc(100vw-24px)] rounded-xl border-blue-100 p-3 shadow-md"
      aria-hidden={!open || undefined} inert={!open}
      style={{ animation: `${open ? "shift-display-in" : "shift-display-out"} ${controlPopoverMotion.duration * 1000}ms ${controlPopoverMotion.cssEase}`, background: "linear-gradient(135deg, #ffffff, #f8fbff)", willChange: "transform, opacity", transformOrigin: "var(--radix-popover-content-transform-origin)", "--shift-display-scale": reduceMotion ? 1 : controlPopoverMotion.scale } as React.CSSProperties}
      onInteractOutside={event => {
        // 契約絞り込みの選択肢は別ポータルに描画される。
        if (event.target instanceof Element && event.target.closest("[data-custom-select-popup]")) event.preventDefault();
      }}>

      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold">表示</span>
        <button type="button" aria-label="表示設定を閉じる" onClick={() => setOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"><FontAwesomeIcon icon={faXmark}/></button>
      </div>
      {children}
    </PopoverContent>
  </Popover>;
}
