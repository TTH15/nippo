"use client";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faGift } from "@fortawesome/free-solid-svg-icons";
import { CountUp } from "@/lib/components/CountUp";

/**
 * 手動ボーナス付与の祝福オーバーレイ。
 * 次回アプリ起動時に1回だけ表示する想定（TeamPointsBadge から制御）。
 * デザイン調整は /preview/animations でプレビュー可能。
 */
export function BonusOverlay({ points, onClose }: { points: number; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-6 bonus-overlay-fade" onClick={onClose}>
      <div
        className="w-full max-w-xs rounded-3xl bg-white p-7 text-center shadow-xl bonus-overlay-pop"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 text-amber-500">
          <FontAwesomeIcon icon={faGift} className="bonus-overlay-icon h-7 w-7" />
        </div>
        <h2 className="text-base font-semibold text-slate-900">ボーナスポイントが付与されました</h2>
        <CountUp
          value={points}
          durationMs={1000}
          prefix="+"
          suffix=" pt"
          className="mt-3 block text-4xl font-extrabold text-amber-500 tabular-nums"
        />
        <button
          type="button"
          onClick={onClose}
          className="mt-6 w-full rounded-xl bg-slate-800 py-3 text-sm font-semibold text-white hover:bg-slate-900"
        >
          やった！
        </button>
      </div>
    </div>
  );
}
