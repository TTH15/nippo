"use client";

import { useRef } from "react";

// ============================================================
// KYC（本登録）ウィザード共通部品。/join（初期登録）と /register（移行導線）で共用。
// 撮影は <input type="file" capture>、送信前に canvas 縮小→JPEG 再エンコードして
// 既存 POST /api/me/registration/photo（8MB上限・JPEG/PNG 制約）に確実に収める。
// ============================================================

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 数字だけ入力させ YYYY-MM-DD へ自動整形（mobile と同挙動）。
export const formatDateInput = (raw: string): string => {
  const d = raw.replace(/\D/g, "").slice(0, 8);
  let out = d.slice(0, 4);
  if (d.length > 4) out += "-" + d.slice(4, 6);
  if (d.length > 6) out += "-" + d.slice(6, 8);
  return out;
};

// 画像を長辺 maxDim 以内へ縮小し JPEG(base64・prefix なし) へ再エンコード。
export async function fileToJpegBase64(file: File, maxDim = 1600, quality = 0.72): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("画像を読み込めませんでした"));
      el.src = url;
    });
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("画像処理に失敗しました");
    ctx.drawImage(img, 0, 0, w, h);
    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    return dataUrl.split(",")[1] ?? "";
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function KycPhotoBox({
  title,
  done,
  previewUri,
  busy,
  onPick,
  capture = "environment",
}: {
  title: string;
  done: boolean;
  previewUri?: string;
  busy: boolean;
  onPick: (file: File) => void;
  // 顔写真はインカメラ（user）を既定にできるようにする。
  capture?: "environment" | "user";
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-slate-700">{title}</p>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className={`w-full h-44 rounded-lg border flex items-center justify-center overflow-hidden ${
          done ? "border-emerald-500 bg-emerald-50" : "border-dashed border-slate-300 bg-slate-50"
        } disabled:opacity-60`}
      >
        {previewUri ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewUri} alt="preview" className="w-full h-full object-cover" />
        ) : busy ? (
          <span className="text-sm text-slate-400">処理中...</span>
        ) : (
          <span className={`text-sm ${done ? "text-emerald-600 font-semibold" : "text-slate-400"}`}>
            {done ? "✓ 登録済み（撮り直し可）" : "タップして撮影・選択"}
          </span>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture={capture}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}
