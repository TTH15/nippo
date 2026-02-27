"use client";

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
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-lg shadow-lg w-full max-w-sm">
        <div className="px-5 pt-5 pb-3 border-b border-slate-200 flex items-start gap-3">
          <div className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-full bg-red-100">
            <span className="text-red-600 text-sm font-bold">!</span>
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          </div>
        </div>
        <div className="px-5 py-4 space-y-3">
          <p className="text-sm text-slate-700 whitespace-pre-line">{message}</p>
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

