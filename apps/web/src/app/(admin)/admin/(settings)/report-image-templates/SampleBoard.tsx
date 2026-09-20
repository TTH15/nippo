"use client";

import { useRef, useState } from "react";
import type { Box } from "@repo/core/logic/reportImageTemplate";

// ============================================================
// 見本画像の上で「どこにどの数字があるか」を枠で決める。
// 枠は見本画像の座標で持ち、読み取り側が画面サイズ・トリミングのずれを補正して使う。
// ============================================================

export type BoardField = { id: string; label: string; rect: Box };

export function SampleBoard({
  url,
  width,
  height,
  fields,
  selectedId,
  onSelect,
  onDraw,
  readOnly = false,
}: {
  url: string;
  width: number;
  height: number;
  fields: BoardField[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDraw: (rect: Box) => void;
  readOnly?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

  /** 画面上の位置を見本画像の座標に直す */
  const toImage = (clientX: number, clientY: number) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return { x: 0, y: 0 };
    return {
      x: ((clientX - rect.left) / rect.width) * width,
      y: ((clientY - rect.top) / rect.height) * height,
    };
  };

  const percent = (box: Box) => ({
    left: `${(box.x / width) * 100}%`,
    top: `${(box.y / height) * 100}%`,
    width: `${(box.w / width) * 100}%`,
    height: `${(box.h / height) * 100}%`,
  });

  const finish = () => {
    if (!drag) return;
    const rect: Box = {
      x: Math.min(drag.x0, drag.x1),
      y: Math.min(drag.y0, drag.y1),
      w: Math.abs(drag.x1 - drag.x0),
      h: Math.abs(drag.y1 - drag.y0),
    };
    setDrag(null);
    // 押しただけの小さすぎる枠は作らない
    if (rect.w > width * 0.01 && rect.h > height * 0.005) onDraw(rect);
  };

  return (
    <div
      ref={ref}
      className="relative select-none overflow-hidden rounded-lg border border-slate-200 bg-slate-50"
      onPointerDown={(event) => {
        if (readOnly) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        const point = toImage(event.clientX, event.clientY);
        setDrag({ x0: point.x, y0: point.y, x1: point.x, y1: point.y });
      }}
      onPointerMove={(event) => {
        if (!drag) return;
        const point = toImage(event.clientX, event.clientY);
        setDrag((prev) => (prev ? { ...prev, x1: point.x, y1: point.y } : prev));
      }}
      onPointerUp={finish}
      onPointerCancel={() => setDrag(null)}
    >
      <img src={url} alt="様式の見本" className="pointer-events-none block w-full" />
      {fields.map((field) => (
        <button
          key={field.id}
          type="button"
          onPointerDown={(event) => {
            event.stopPropagation();
            onSelect(field.id);
          }}
          style={percent(field.rect)}
          className={`absolute rounded-sm border-2 text-[10px] font-medium ${
            field.id === selectedId ? "border-sky-500 bg-sky-500/15 text-sky-800" : "border-emerald-500/70 bg-emerald-500/5 text-emerald-800"
          }`}
        >
          <span className="absolute -top-4 left-0 whitespace-nowrap rounded bg-white/90 px-1">{field.label}</span>
        </button>
      ))}
      {drag && (
        <span
          aria-hidden
          className="absolute border-2 border-sky-500 bg-sky-500/20"
          style={percent({
            x: Math.min(drag.x0, drag.x1),
            y: Math.min(drag.y0, drag.y1),
            w: Math.abs(drag.x1 - drag.x0),
            h: Math.abs(drag.y1 - drag.y0),
          })}
        />
      )}
    </div>
  );
}
