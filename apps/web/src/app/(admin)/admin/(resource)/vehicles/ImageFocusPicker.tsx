"use client";

import { useCallback, useRef, useState } from "react";

// ============================================================
// 一覧サムネイル（16:9・object-cover）で「どこを中心に見せるか」を選ぶ。
// 画像全体を表示し、その上をクリック／ドラッグして中心点を指定する。
// 値は CSS の object-position と同じ 0〜100（%）。
// ============================================================

export type Focus = { x: number; y: number };

export function ImageFocusPicker({
  src,
  value,
  onChange,
  disabled,
}: {
  src: string;
  value: Focus;
  onChange: (next: Focus) => void;
  disabled?: boolean;
}) {
  const areaRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const setFromPoint = useCallback(
    (clientX: number, clientY: number) => {
      const el = areaRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const x = Math.min(100, Math.max(0, Math.round(((clientX - rect.left) / rect.width) * 100)));
      const y = Math.min(100, Math.max(0, Math.round(((clientY - rect.top) / rect.height) * 100)));
      onChange({ x, y });
    },
    [onChange],
  );

  if (!src) return null;

  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500">
        一覧に表示したい位置をタップ（ドラッグでも調整できます）。
      </p>

      <div
        ref={areaRef}
        className={`relative select-none overflow-hidden rounded-md border border-slate-200 ${
          disabled ? "cursor-not-allowed opacity-60" : "cursor-crosshair"
        }`}
        onPointerDown={(e) => {
          if (disabled) return;
          // ドラッグ中に指/カーソルが要素外へ出ても追従させる
          e.currentTarget.setPointerCapture(e.pointerId);
          setDragging(true);
          setFromPoint(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => {
          if (!dragging || disabled) return;
          setFromPoint(e.clientX, e.clientY);
        }}
        onPointerUp={(e) => {
          setDragging(false);
          e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        onPointerCancel={() => setDragging(false)}
      >
        {/* 画像は全体を見せる（切り取らない）。この上で中心点を選ぶ。 */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="表示位置の指定" className="block max-h-64 w-full object-contain bg-slate-50" draggable={false} />

        {/* 選択中の中心点 */}
        <span
          className="pointer-events-none absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-slate-900/70 shadow"
          style={{ left: `${value.x}%`, top: `${value.y}%` }}
          aria-hidden
        />
      </div>

      {/* 実際の一覧と同じ 16:9・object-cover でプレビュー */}
      <div>
        <p className="mb-1 text-xs font-medium text-slate-500">一覧での見え方</p>
        <div className="aspect-video w-full max-w-xs overflow-hidden rounded-md bg-slate-100">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt="一覧プレビュー"
            className="h-full w-full object-cover"
            style={{ objectPosition: `${value.x}% ${value.y}%` }}
          />
        </div>
      </div>

      {!disabled && (value.x !== 50 || value.y !== 50) && (
        <button
          type="button"
          onClick={() => onChange({ x: 50, y: 50 })}
          className="text-xs text-slate-500 hover:text-slate-700"
        >
          中央に戻す
        </button>
      )}
    </div>
  );
}
