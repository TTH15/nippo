"use client";

import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

type ConfirmDialogProps = {
  open: boolean;
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "neutral";
  onConfirm: () => void;
  onClose: () => void;
};

export function ConfirmDialog({
  open,
  title = "確認",
  message,
  confirmLabel = "OK",
  cancelLabel = "キャンセル",
  tone = "danger",
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const titleId = useId();
  const messageId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = requestAnimationFrame(() => cancelRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocusRef.current?.focus();
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  const confirmTone = tone === "danger"
    ? "bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-500/30"
    : "bg-slate-800 text-white hover:bg-slate-700 focus-visible:ring-slate-700/30";

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        className="w-full max-w-sm overflow-hidden rounded-2xl border border-white/70 bg-white shadow-2xl shadow-slate-950/20"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-slate-100 px-5 pb-3 pt-5">
          <h2 id={titleId} className="text-base font-semibold text-slate-900">{title}</h2>
        </div>
        <div className="px-5 py-4">
          <p id={messageId} className="whitespace-pre-line text-sm leading-6 text-slate-600">{message}</p>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50/70 px-5 py-3">
          <button
            ref={cancelRef}
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-xs font-medium text-slate-600 transition-colors hover:bg-white hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/30"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={() => {
              onConfirm();
              onClose();
            }}
            className={`rounded-lg px-4 py-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-4 ${confirmTone}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
