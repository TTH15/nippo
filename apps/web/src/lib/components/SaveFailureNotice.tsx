"use client";

/** 管理フォームと隔離プレビューで共用する保存失敗表示。 */
export function SaveFailureNotice({ message, onRetry, onReview, busy = false }: {
  message: string; onRetry: () => void; onReview?: () => void; busy?: boolean;
}) {
  if (!message) return null;
  return <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
    <p className="whitespace-pre-line">{message}</p>
    <div className="mt-2 flex flex-wrap gap-2">
      <button type="button" disabled={busy} onClick={onRetry} className="min-h-11 rounded-lg border border-red-200 bg-white px-3 text-xs font-medium disabled:opacity-50">未保存の項目を再試行</button>
      {onReview && <button type="button" disabled={busy} onClick={onReview} className="min-h-11 rounded-lg border border-red-200 bg-white px-3 text-xs disabled:opacity-50">最新の契約を確認</button>}
    </div>
  </div>;
}
