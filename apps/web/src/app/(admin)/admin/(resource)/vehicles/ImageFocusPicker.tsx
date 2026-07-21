"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowUpFromBracket, faExpand } from "@fortawesome/free-solid-svg-icons";

// ============================================================
// 一覧サムネイル（16:9）で「どこを切り取って見せるか」を面で指定する。
//
// 画像は1枚だけ表示し、その上に 16:9 の切り取り枠を重ねる。
// 枠の外は暗くして「一覧では見えない範囲」を示す。枠はドラッグで動かす。
//
// 保存値は CSS の object-position と同じ 0〜100(%)。
// object-cover は「はみ出した分をどの比率で配置するか」で切り取り位置が決まるため、
// 枠のオフセット ÷ はみ出し量 = その比率、という対応で相互変換できる。
// ============================================================

export type Focus = { x: number; y: number };

const ASPECT = 16 / 9;

export function ImageFocusPicker({
  src,
  value,
  onChange,
  onReplace,
  onExpand,
  disabled,
}: {
  src: string;
  value: Focus;
  onChange: (next: Focus) => void;
  /** 画像を差し替える導線。 */
  onReplace?: () => void;
  /** 原寸表示。 */
  onExpand?: () => void;
  disabled?: boolean;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; startFocus: Focus } | null>(null);

  // 表示中の画像サイズを測る（切り取り枠の寸法計算に使う）
  const measure = useCallback(() => {
    const el = imgRef.current;
    if (!el || !el.clientWidth) return;
    setBox({ w: el.clientWidth, h: el.clientHeight });
  }, []);

  useLayoutEffect(() => {
    measure();
    const el = imgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, src]);

  // 切り取り枠のサイズ: 画像に収まる最大の 16:9
  const crop = box
    ? box.w / box.h > ASPECT
      ? { w: box.h * ASPECT, h: box.h } // 画像が横長 → 高さいっぱい、左右に余り
      : { w: box.w, h: box.w / ASPECT } // 画像が縦長 → 幅いっぱい、上下に余り
    : null;

  const overflowX = box && crop ? Math.max(0, box.w - crop.w) : 0;
  const overflowY = box && crop ? Math.max(0, box.h - crop.h) : 0;

  // focus(%) → 枠の左上座標
  const left = (overflowX * value.x) / 100;
  const top = (overflowY * value.y) / 100;

  const clamp = (n: number) => Math.min(100, Math.max(0, Math.round(n)));

  const moveTo = (nextLeft: number, nextTop: number) => {
    onChange({
      x: overflowX > 0 ? clamp((nextLeft / overflowX) * 100) : 50,
      y: overflowY > 0 ? clamp((nextTop / overflowY) * 100) : 50,
    });
  };

  if (!src) return null;

  const movable = overflowX > 0 || overflowY > 0;

  return (
    <div className="space-y-2">
      {/* 操作ボタンは画像の下にまとめる（右上は削除ボタンと重なるため） */}
      <div className="mx-auto flex w-fit max-w-full items-center justify-center gap-1">
        {onExpand && (
          <button
            type="button"
            onClick={onExpand}
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
          >
            <FontAwesomeIcon icon={faExpand} className="h-3 w-3" />
            拡大
          </button>
        )}
        {onReplace && !disabled && (
          <button
            type="button"
            onClick={onReplace}
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
          >
            <FontAwesomeIcon icon={faArrowUpFromBracket} className="h-3 w-3" />
            差し替え
          </button>
        )}
      </div>

      {/* 元画像は左右中央に置く */}
      <div className="relative mx-auto block w-fit max-w-full select-none overflow-hidden rounded-md border border-slate-200 bg-slate-900">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imgRef}
          src={src}
          alt="表示範囲の指定"
          className="block max-h-72 w-auto max-w-full"
          draggable={false}
          onLoad={measure}
        />

        {crop && (
          <>
            {/* 枠外を暗くする（4辺を個別に敷く。枠内は素の明るさを保つ） */}
            <div className="pointer-events-none absolute inset-x-0 top-0 bg-black/55" style={{ height: top }} />
            <div
              className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/55"
              style={{ height: Math.max(0, (box?.h ?? 0) - top - crop.h) }}
            />
            <div
              className="pointer-events-none absolute left-0 bg-black/55"
              style={{ top, height: crop.h, width: left }}
            />
            <div
              className="pointer-events-none absolute right-0 bg-black/55"
              style={{ top, height: crop.h, width: Math.max(0, (box?.w ?? 0) - left - crop.w) }}
            />

            {/* 切り取り枠。ドラッグで移動 */}
            <div
              className={`absolute border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,.35)] ${
                disabled || !movable ? "" : "cursor-move"
              }`}
              style={{ left, top, width: crop.w, height: crop.h }}
              onPointerDown={(e) => {
                if (disabled || !movable) return;
                e.currentTarget.setPointerCapture(e.pointerId);
                dragRef.current = { startX: e.clientX, startY: e.clientY, startFocus: value };
              }}
              onPointerMove={(e) => {
                const d = dragRef.current;
                if (!d || disabled) return;
                const baseLeft = (overflowX * d.startFocus.x) / 100;
                const baseTop = (overflowY * d.startFocus.y) / 100;
                moveTo(
                  Math.min(overflowX, Math.max(0, baseLeft + (e.clientX - d.startX))),
                  Math.min(overflowY, Math.max(0, baseTop + (e.clientY - d.startY))),
                );
              }}
              onPointerUp={(e) => {
                dragRef.current = null;
                e.currentTarget.releasePointerCapture(e.pointerId);
              }}
              onPointerCancel={() => {
                dragRef.current = null;
              }}
            >
              {/* 一覧で見えている範囲だと分かるラベル */}
              <span className="absolute left-1 top-1 rounded bg-white/85 px-1 text-[10px] font-medium text-slate-700">
                一覧に出る範囲
              </span>
            </div>
          </>
        )}
      </div>

      {!disabled && movable && (value.x !== 50 || value.y !== 50) && (
        <button
          type="button"
          onClick={() => onChange({ x: 50, y: 50 })}
          className="mx-auto block text-xs text-slate-500 hover:text-slate-700"
        >
          中央に戻す
        </button>
      )}
    </div>
  );
}
