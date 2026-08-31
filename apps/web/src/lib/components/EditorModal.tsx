"use client";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark } from "@fortawesome/free-solid-svg-icons";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";
import { cn } from "@/lib/ui/utils";

export function EditorModal({ title, children, footer, onClose, variant = "driver" }: { title: string; children: ReactNode; footer?: ReactNode; onClose: () => void; variant?: "driver" | "shift" }) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useBodyScrollLock(true);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const escape = (event: KeyboardEvent) => {
      const dialogs = document.querySelectorAll('[role="dialog"]');
      if (event.key === "Escape" && !event.defaultPrevented && dialogs[dialogs.length - 1] === panel.current) closeRef.current();
    };
    window.addEventListener("keydown", escape);
    return () => { window.removeEventListener("keydown", escape); previous?.focus(); };
  }, []);
  return createPortal(<div className="modal-backdrop-in fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
    <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} className={cn("modal-panel-in flex max-h-[85vh] w-full flex-col bg-white text-slate-800 shadow-lg outline-none", variant === "shift" ? "max-w-xl rounded-xl" : "max-w-2xl rounded-lg p-5")} onClick={event => event.stopPropagation()}>
      <div className={cn("flex shrink-0 items-center justify-between gap-3", variant === "shift" ? "border-b border-slate-200 px-4 py-3" : "mb-4")}><h2 id={titleId} className={cn("font-semibold text-slate-900", variant === "shift" ? "text-sm" : "text-lg")}>{title}</h2><button aria-label="編集を閉じる" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded text-slate-500 hover:bg-slate-100"><FontAwesomeIcon icon={faXmark}/></button></div>
      <div className={cn("min-h-0 flex-1 overflow-y-auto", variant === "shift" ? "p-4" : "-mr-1 pr-1")}>{children}</div>
      {footer && <div className={cn("shrink-0 border-t border-slate-100", variant === "shift" ? "px-4 py-3" : "mt-4 pt-3")}>{footer}</div>}
    </div>
  </div>, document.body);
}
