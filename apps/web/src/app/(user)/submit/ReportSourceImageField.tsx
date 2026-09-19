"use client";

import { useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCircleCheck, faImage, faTriangleExclamation } from "@fortawesome/free-solid-svg-icons";
import { getToken } from "@/lib/api";
import { useApi } from "@/lib/useApi";

// ============================================================
// 日報に配完個数表などの原本画像を添える。
// 設計: docs/design/report-image-evidence-2026-09.md（RIMG-2）
//
// ★受け取ったファイルをそのまま送る。**圧縮・回転・切り抜きをしない**
//   （このアプリの他の画像送信は clientImageCompression を通すが、原本はそのまま）。
// ★画像の作成日時は Web のファイル選択では取れないことが多い。取れないものを
//   現在時刻で埋めず「不明」のまま送る。ファイルの更新日時は別の事実として送る。
// ★件数の読み取り（OCR）はまだ無い。ここは「原本を出す」だけで、
//   件数の入力は従来どおり手入力のまま。
// ============================================================

const ACCEPT = "image/jpeg,image/png";
const MAX_BYTES = 20 * 1024 * 1024;

type SourceImage = {
  id: string;
  report_date: string;
  status: string;
  received_at: string;
  original_filename: string | null;
  byte_size: number;
};

type ListResponse = { images: SourceImage[]; unavailable?: boolean };

/** 画像そのものは変えずに、縦横だけ読む */
function readSize(file: File): Promise<{ width: number | null; height: number | null }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: image.naturalWidth || null, height: image.naturalHeight || null });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ width: null, height: null });
    };
    image.src = url;
  });
}

export default function ReportSourceImageField({
  reportDate,
  courseId,
}: {
  reportDate: string;
  courseId?: string | null;
}) {
  const { data, refresh } = useApi<ListResponse>(`/api/reports/source-images?date=${reportDate}`);
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const images = data?.images ?? [];
  if (data?.unavailable) return null;

  const upload = async (file: File) => {
    setError(null);
    if (file.size > MAX_BYTES) {
      setError(`画像は${Math.floor(MAX_BYTES / (1024 * 1024))}MBまでです`);
      return;
    }
    setUploading(true);
    try {
      const { width, height } = await readSize(file);
      const form = new FormData();
      form.append("file", file);
      form.append(
        "meta",
        JSON.stringify({
          reportDate,
          courseId: courseId ?? null,
          clientKey: crypto.randomUUID(),
          originalFilename: file.name,
          // Web のファイル選択で取れるのは更新日時だけ。作成日時は「不明」のまま送る
          fileModifiedAt: file.lastModified ? new Date(file.lastModified).toISOString() : null,
          capturedAtSource: "unknown",
          width,
          height,
        }),
      );
      // multipart なので apiFetch（JSON 前提）ではなく fetch を直接使う。
      // 認証は既存の添付アップロードと同じく getToken()（永続キーには触らない）
      const token = getToken();
      const response = await fetch("/api/reports/source-images", {
        method: "POST",
        body: form,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "画像を送れませんでした");
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "画像を送れませんでした");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4" aria-label="配完表の画像">
      <div className="mb-2 flex items-center gap-2">
        <FontAwesomeIcon icon={faImage} className="h-3.5 w-3.5 text-slate-400" />
        <h3 className="text-sm font-medium text-slate-800">配完表の画像</h3>
      </div>

      {images.length > 0 && (
        <ul className="mb-3 divide-y divide-slate-100">
          {images.map((image) => (
            <li key={image.id} className="flex items-center gap-2 py-1.5 text-xs">
              <FontAwesomeIcon icon={faCircleCheck} className="h-3 w-3 text-emerald-600" />
              <span className="min-w-0 flex-1 truncate text-slate-700">{image.original_filename || "画像"}</span>
              <span className="tabular-nums text-slate-500">{Math.round(image.byte_size / 1024)}KB</span>
            </li>
          ))}
        </ul>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      <button
        type="button"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
        className="min-h-11 w-full rounded-lg border border-slate-300 px-4 text-sm font-medium text-slate-700 disabled:opacity-50"
      >
        {uploading ? "送信中…" : images.length > 0 ? "画像を追加" : "画像を選ぶ"}
      </button>

      {error && (
        <p role="alert" className="mt-2 text-xs text-red-600">
          <FontAwesomeIcon icon={faTriangleExclamation} className="mr-1 h-3 w-3" />
          {error}
        </p>
      )}
    </section>
  );
}
