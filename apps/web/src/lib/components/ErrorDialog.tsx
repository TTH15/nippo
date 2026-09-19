"use client";

import { useEffect, useId, useRef } from "react";

type ErrorDialogProps = {
  open: boolean;
  title?: string;
  message: string;
  detail?: string;
  onClose: () => void;
};

export function ErrorDialog({
  open,
  title = "エラーが発生しました",
  message,
  detail,
  onClose,
}: ErrorDialogProps) {
  const titleId = useId();
  const messageId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // モーダルを名乗る以上、開いたらフォーカスを移し、閉じたら元へ戻す
  // （ConfirmDialog と挙動をそろえる）
  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => closeRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // 外側のモーダルへ同じ Escape を渡さない（ConfirmDialog と同じ扱い）
      event.stopPropagation();
      onCloseRef.current();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        // ConfirmDialog と同じ扱いにそろえる（読み上げにモーダルとして伝わる）
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        className="bg-white rounded-lg shadow-lg w-full max-w-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-5 pb-3 border-b border-slate-200 flex items-start gap-3">
          <div className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-full bg-red-100">
            <span className="text-red-600 text-sm font-bold">!</span>
          </div>
          <div>
            <h2 id={titleId} className="text-sm font-semibold text-slate-900">{title}</h2>
          </div>
        </div>
        <div className="px-5 py-4 space-y-3">
          <p id={messageId} className="text-sm text-slate-700 whitespace-pre-line">{message}</p>
          {detail && (
            <div className="rounded bg-slate-50 border border-slate-200 px-3 py-2">
              <p className="text-[11px] font-mono text-slate-500 break-all whitespace-pre-line">
                {detail}
              </p>
            </div>
          )}
        </div>
        <div className="px-5 py-3 flex justify-end border-t border-slate-100">
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-medium rounded bg-slate-800 text-white hover:bg-slate-700 transition-colors"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}

