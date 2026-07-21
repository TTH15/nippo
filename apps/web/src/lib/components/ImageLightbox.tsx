"use client";

import { useEffect } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark } from "@fortawesome/free-solid-svg-icons";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";

// ============================================================
// 画像を原寸（アップロードしたまま）で見るためのライトボックス。
// 一覧のサムネイルは 16:9 に切り取られるため、全体を確認する手段が要る。
// 画像をタップ/クリックで開き、背景・×・Esc で閉じる。
// ============================================================

export function ImageLightbox({
  src,
  alt,
  onClose,
}: {
  src: string | null;
  alt?: string;
  onClose: () => void;
}) {
  useBodyScrollLock(Boolean(src));

  // Esc で閉じる（拡大表示は「戻る」導線が分かりにくいため）
  useEffect(() => {
    if (!src) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [src, onClose]);

  if (!src) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-slate-700 shadow transition-colors hover:bg-white"
        aria-label="閉じる"
      >
        <FontAwesomeIcon icon={faXmark} className="h-4 w-4" />
      </button>
      {/* 画面に収まる範囲で最大表示。はみ出す場合はスクロールで全体を見られる */}
      <div className="max-h-full max-w-full overflow-auto" onClick={(e) => e.stopPropagation()}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt ?? "画像"}
          className="max-h-[90vh] max-w-full object-contain"
        />
      </div>
    </div>
  );
}
