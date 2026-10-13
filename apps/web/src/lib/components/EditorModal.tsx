"use client";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark } from "@fortawesome/free-solid-svg-icons";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";
import { useModalKeys } from "@/lib/ui/dialog";
import { cn } from "@/lib/ui/utils";

export function EditorModal({ title, children, header, footer, onClose, variant = "driver", dismissible = true, trapFocus = false, fixedHeight = false, centerContent = false }: { title: string; children: ReactNode; header?: ReactNode; footer?: ReactNode; onClose: () => void; variant?: "driver" | "shift" | "setup"; dismissible?: boolean; trapFocus?: boolean; fixedHeight?: boolean; centerContent?: boolean }) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useBodyScrollLock(true);
  // 必須入力では背景・Escapeで閉じず、Tabもモーダル内に保つ。
  useModalKeys(!dismissible || trapFocus, dismissible ? onClose : () => {}, panel);
  useEffect(() => {
    if (!dismissible || trapFocus) return;
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const escape = (event: KeyboardEvent) => {
      const dialogs = document.querySelectorAll('[role="dialog"]');
      if (event.key === "Escape" && !event.defaultPrevented && dialogs[dialogs.length - 1] === panel.current) closeRef.current();
    };
    window.addEventListener("keydown", escape);
    return () => { window.removeEventListener("keydown", escape); previous?.focus(); };
  }, [dismissible, trapFocus]);
  return createPortal(<div className="modal-backdrop-in fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={dismissible ? onClose : undefined}>
    <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} className={cn("modal-panel-in flex max-h-[85vh] w-full flex-col bg-white text-slate-800 shadow-lg outline-none", fixedHeight && (variant === "setup" ? "h-[min(32rem,85svh)]" : "h-[min(36rem,85svh)]"), centerContent && "justify-center", variant === "shift" ? "max-w-xl rounded-xl" : variant === "setup" ? "max-w-lg rounded-lg p-5" : "max-w-2xl rounded-lg p-5")} onClick={event => event.stopPropagation()}>
      {header && <div className="mb-4 shrink-0">{header}</div>}
      <div className={cn("flex shrink-0 items-center justify-between gap-3", variant === "shift" ? "border-b border-slate-200 px-4 py-3" : "mb-4")}><h2 id={titleId} tabIndex={dismissible && !trapFocus ? undefined : 0} className={cn("font-semibold text-slate-900 outline-none", variant === "shift" ? "text-sm" : header ? "text-base" : "text-lg")}>{title}</h2>{dismissible && <button aria-label="編集を閉じる" onClick={onClose} className="flex h-11 w-11 items-center justify-center rounded text-slate-500 hover:bg-slate-100"><FontAwesomeIcon icon={faXmark}/></button>}</div>
      <div className={cn("min-h-0 overflow-y-auto", centerContent ? "flex-initial" : "flex-1", variant === "shift" ? "p-4" : "-mr-1 pr-1")}>{children}</div>
      {footer && <div className={cn("shrink-0", centerContent || variant === "setup" ? "mt-3" : "border-t border-slate-100", variant === "shift" ? "px-4 py-3" : centerContent || variant === "setup" ? "" : "mt-4 pt-3")}>{footer}</div>}
    </div>
  </div>, document.body);
}
