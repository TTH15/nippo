"use client";

// ============================================================
// ローディング演出のプレビュー（開発用・認証不要）。
// シフトAI取り込み中の「ピクセルが積み上がって箱になる」ローダーの見た目確認。
// ============================================================

import { PixelBoxLoader } from "@/lib/components/PixelBoxLoader";

export default function LoaderPreviewPage() {
  return (
    <div className="min-h-screen bg-slate-100 py-8 px-4">
      <div className="max-w-md mx-auto space-y-6">
        <div>
          <h1 className="text-lg font-bold text-slate-900">ピクセル箱ローダー</h1>
          <p className="text-xs text-slate-500 mt-1">
            シフトAI取り込み中の表示。積み上げ→完成→フェードのループ。
          </p>
        </div>
        <div className="rounded-lg bg-white p-8 shadow-sm flex flex-col items-center gap-4">
          <PixelBoxLoader />
          <p className="text-sm font-medium text-slate-700">AI がシフト表を読み取っています…</p>
          <p className="text-[11px] text-slate-400">ファイル数・表の大きさにより 30秒〜数分かかります</p>
        </div>
      </div>
    </div>
  );
}
