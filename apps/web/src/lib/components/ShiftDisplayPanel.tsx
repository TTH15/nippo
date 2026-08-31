"use client";

import { useId, useState, type ReactNode } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronDown, faSliders } from "@fortawesome/free-solid-svg-icons";
import { SmoothCollapse } from "./SmoothCollapse";
import { cn } from "@/lib/ui/utils";

/** 開閉だけでシフト表全体を再描画しないよう、開閉状態をパネル内に閉じ込める。 */
export function ShiftDisplayPanel({ toolbar, children }: {
  toolbar: (trigger: ReactNode) => ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const triggerId = `${id}-toggle`;
  const panelId = `${id}-panel`;
  return <>
    {toolbar(<button type="button" id={triggerId} aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(value => !value)} className={cn("mr-auto inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border px-3 text-xs", open ? "border-slate-800 bg-slate-800 text-white" : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50")}>
      <FontAwesomeIcon icon={faSliders}/>表示<FontAwesomeIcon icon={faChevronDown} rotation={open ? 180 : undefined}/>
    </button>)}
    <SmoothCollapse open={open} id={panelId} labelledBy={triggerId}>
      <div className="pb-3">{children}</div>
    </SmoothCollapse>
  </>;
}
