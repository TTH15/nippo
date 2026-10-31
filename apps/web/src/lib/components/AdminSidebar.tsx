"use client";

import { useId, useLayoutEffect, useRef, type ReactNode } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronLeft, faChevronRight } from "@fortawesome/free-solid-svg-icons";
import { SmoothCollapse } from "./SmoothCollapse";
import { setAdminSidebarOpen, useAdminSidebarOpen } from "@/lib/hooks/useAdminSidebarOpen";

/** 本番と隔離プレビューで管理メニューの開閉を共有する。 */
export function AdminSidebar({ logo, children }: { logo: ReactNode; children: ReactNode | ((state: { open: boolean; expand: (focusId?: string) => void }) => ReactNode) }) {
  const open = useAdminSidebarOpen();
  const contentId = useId();
  const focusTarget = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (open && focusTarget.current) { document.getElementById(focusTarget.current)?.focus(); focusTarget.current = null; }
  }, [open]);
  const expand = (focusId?: string) => { focusTarget.current = focusId ?? null; setAdminSidebarOpen(true); };
  const toggle = <button type="button" onClick={() => setAdminSidebarOpen(!open)}
    aria-label={open ? "メニューを閉じる" : "メニューを開く"} aria-expanded={open} aria-controls={contentId}
    title={open ? "メニューを閉じる" : "メニューを開く"}
    className="absolute right-0.5 group-data-[sidebar-open=false]/sidebar:right-2.5 top-[26px] inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-white text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-400">
    <FontAwesomeIcon icon={open ? faChevronLeft : faChevronRight} className="h-3 w-3" />
  </button>;

  return <aside aria-label="管理サイドバー"
    data-sidebar-open={open} className="group/sidebar sticky top-0 z-40 hidden h-screen shrink-0 overflow-hidden bg-white text-slate-700 md:block">
    <SmoothCollapse open={open} id={contentId} horizontal={{ expandedWidth: 224, collapsedWidth: 64, persistentContent: typeof children === "function", control: toggle }} className="h-full border-r border-slate-200">
      <div inert={!open || undefined} aria-hidden={!open || undefined} className="flex h-24 shrink-0 items-center border-b border-slate-200 pl-2 pr-12 pt-4 group-data-[sidebar-open=false]/sidebar:invisible">
        <div className="min-w-0 flex-1">{logo}</div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">{typeof children === "function" ? children({ open, expand }) : children}</div>
    </SmoothCollapse>
  </aside>;
}
