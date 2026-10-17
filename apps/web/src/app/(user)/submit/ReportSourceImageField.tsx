"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCircleCheck, faImage, faTriangleExclamation } from "@fortawesome/free-solid-svg-icons";
import { apiFetch, apiUpload } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { Button } from "@/lib/ui/button";
import {
  canSkipReview,
  judgeSourceImageDay,
  type ImageTemplate,
  type ReadTrust,
  type SourceImageDuplicate,
} from "@repo/core/logic/reportImageTemplate";
import {
  prefetchReportImageReader,
  readReportImage,
  releaseReaders,
  type ReportImageOutcome,
} from "@/lib/ocr/reportImageReader";
import { reportFormKey } from "@repo/core/logic/dailyReport";
import type { ShiftForm, ValueMap } from "@repo/core/types";
import { reportCycleTitle } from "@/lib/reportCycles";
import type { ImageEntry } from "@repo/core/logic/reportImageEntries";
import { ReportImageReviewSheet, type ReviewTarget, type ReviewRow } from "./ReportImageReviewSheet";

// ============================================================
// 日報に配完個数表などの原本画像を添え、件数を読み取って入力する。
// 設計: docs/design/report-image-evidence-2026-09.md（RIMG-2 / RIMG-3）
//
// ★受け取ったファイルをそのまま送る。**圧縮・回転・切り抜きをしない**
//   （このアプリの他の画像送信は clientImageCompression を通すが、原本はそのまま）。
// ★読み取りは端末の中だけで行う。画像をOCRの外部サービスへ送らない。
// ★読めた値は本人が確認してから日報へ入れる。読めない欄は空のままにする（0で埋めない）。
// ★原本の提出と読み取りの成否は別。読めなくても原本は残り、手入力で進められる。
// ============================================================

const ACCEPT = "image/jpeg,image/png";

const EMPTY_TRUST: ReadTrust = {
  level: "suspect",
  checksRun: 0,
  checksFailed: 0,
  incomplete: true,
  reasons: [],
};
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
type TemplatesResponse = { templates: ImageTemplate[]; autoFillCourseIds?: string[]; unavailable?: boolean };
type UploadResponse = {
  id: string;
  duplicate: SourceImageDuplicate;
  capturedAt: string | null;
  capturedAtSource: "exif" | "photo_library" | "unknown";
};

export type ReportImageEntry = ImageEntry;

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

type Review = {
  context: string;
  outcome: ReportImageOutcome;
  sourceImageId: string;
  imageUrl: string;
  rows: ReviewRow[];
  warnings: string[];
};

export default function ReportSourceImageField({
  reportDate,
  courseId,
  shifts = [],
  values = {},
  onApply,
}: {
  reportDate: string;
  courseId?: string | null;
  shifts?: readonly ShiftForm[];
  values?: ValueMap;
  onApply?: (entries: ReportImageEntry[]) => void;
}) {
  const { data, refresh } = useApi<ListResponse>(`/api/reports/source-images?date=${reportDate}`);
  const { data: templateData } = useApi<TemplatesResponse>("/api/me/report-image-templates");
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [saving, setSaving] = useState(false);
  /** 見比べずに入れたときの結果表示 */
  const [filled, setFilled] = useState<string[]>([]);

  const targets: ReviewTarget[] = shifts.map(shift => ({
    key: reportFormKey(shift.courseId,shift.cycleNo ?? 0),
    label: `${shift.courseName} ${reportCycleTitle(shift.cycleNo ?? 0,shift.cycleLabel,shift.units.flatMap(unit => unit.fields.map(field => field.groupLabel)))}`,
    fields: shift.units.flatMap(unit => unit.fields.map(field => ({ unitId: unit.id,fieldKey: field.fieldKey,value: values[reportFormKey(shift.courseId,shift.cycleNo ?? 0)]?.[unit.id]?.[field.fieldKey] ?? "" }))),
  }));
  const context = JSON.stringify([reportDate,courseId,targets.map(target => [target.key,target.fields.map(field => [field.unitId,field.fieldKey])])]);
  const contextRef = useRef(context); contextRef.current = context;
  const targetsRef = useRef(targets); targetsRef.current = targets;
  const busyRef = useRef(false);
  useEffect(() => { setReview(null);setFilled([]);setError(null); },[context]);
  const routeRow = (row: ReviewRow): ReviewRow => {
    const choices = targetsRef.current.filter(target => target.fields.some(field => field.unitId === row.unitId && field.fieldKey === row.fieldKey));
    return { ...row,targetFormKey: choices.length === 1 ? choices[0].key : undefined,included: choices.length > 0 && row.value != null };
  };
  const images = data?.images ?? [];
  const templates = useMemo(() => templateData?.templates ?? [], [templateData]);
  const canRead = templates.length > 0;
  // 件数が報酬に効かないコースは、確認を省く設定にできる（migration 182）
  const courseAllowsSkip = !!courseId && (templateData?.autoFillCourseIds ?? []).includes(courseId);

  // 言語データは数MBある。様式がある日は先に温めておき、画像を選んだ直後に待たせない
  useEffect(() => {
    if (canRead) prefetchReportImageReader();
    return () => {
      void releaseReaders();
    };
  }, [canRead]);

  useEffect(
    () => () => {
      if (review?.imageUrl) URL.revokeObjectURL(review.imageUrl);
    },
    [review?.imageUrl],
  );

  if (data?.unavailable) return null;

  /** 原本を送る。読み取りの成否と関係なく、まずここを通す */
  const uploadOriginal = async (file: File): Promise<UploadResponse> => {
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
        // Web のファイル選択で取れるのは更新日時だけ。作成日時はサーバーが中身から読む
        fileModifiedAt: file.lastModified ? new Date(file.lastModified).toISOString() : null,
        capturedAtSource: "unknown",
        width,
        height,
      }),
    );
    return apiUpload<UploadResponse>("/api/reports/source-images", form);
  };

  const handleFile = async (file: File) => {
    if (busyRef.current || saving || review) return;
    const requestContext = context;
    setError(null);
    if (file.type !== "image/jpeg" && file.type !== "image/png") {
      setError("PNGまたはJPEGの画像を選んでください");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(`画像は${Math.floor(MAX_BYTES / (1024 * 1024))}MBまでです`);
      return;
    }
    busyRef.current = true;
    setBusy(canRead ? "画像を読んでいます" : "送信中…");
    setFilled([]);
    try {
      // 様式は読む瞬間に取り直す。開きっぱなしの画面が、差し替え前の古い様式で読まないようにする
      const fresh = await apiFetch<TemplatesResponse>("/api/me/report-image-templates").catch(() => null);
      const latestTemplates = fresh?.templates ?? templates;
      // 原本の送信と読み取りは同時に走らせる。送信の待ち時間ぶん読み取りが遅れないようにする
      const [uploadResult, readResult] = await Promise.allSettled([
        uploadOriginal(file),
        latestTemplates.length > 0
          ? readReportImage(file, latestTemplates, { reportDate, onStep: (step) => setBusy(step) })
          : Promise.resolve(null),
      ]);
      if (contextRef.current !== requestContext) return;
      await refresh();
      if (uploadResult.status === "rejected") {
        throw uploadResult.reason instanceof Error ? uploadResult.reason : new Error("画像を送れませんでした");
      }
      const uploaded = uploadResult.value;
      if (latestTemplates.length === 0) return;
      if (readResult.status === "rejected") {
        setError("この画像からは件数を読み取れません。件数は手入力してください");
        return;
      }
      const outcome = readResult.value;
      if (!outcome || !outcome.template || !outcome.result) {
        setError("この画像からは件数を読み取れません。件数は手入力してください");
        return;
      }

      const judged = judgeSourceImageDay({
        reportDate,
        capturedAt: uploaded.capturedAt,
        capturedAtSource: uploaded.capturedAtSource,
        readDate: outcome.result.readDate,
        duplicate: uploaded.duplicate,
      });

      const entries = outcome.result.fields
        .filter((field) => (field.role ?? "entry") === "entry" && typeof field.value === "number" && field.unitId && field.fieldKey)
        .map((field) => ({ unitId: field.unitId, fieldKey: field.fieldKey, value: field.value as number }));

      // 裏が取れている読み取り、または確認を省く設定のコースは、見比べずにそのまま入れる
      if (canSkipReview(outcome.result.trust, { courseAllowsSkip }) && entries.length > 0 && new Set(entries.map(entry => JSON.stringify([entry.unitId,entry.fieldKey]))).size === entries.length && targetsRef.current.length === 1 && images.length === 0 &&
        entries.every(entry => targetsRef.current[0].fields.some(field => field.unitId === entry.unitId && field.fieldKey === entry.fieldKey && field.value === ""))) {
        await saveReading(
          {
            context: requestContext,
            outcome,
            sourceImageId: uploaded.id,
            rows: outcome.result.fields
              .filter((field) => (field.role ?? "entry") === "entry")
              .map((field) => ({
                fieldId: field.fieldId,
                unitId: field.unitId,
                fieldKey: field.fieldKey,
                label: field.label,
                value: typeof field.value === "number" ? field.value : null,
                status: field.status,
                box: field.box,
                cropUrl: null,
              })),
            imageUrl: "",
            warnings: [],
          },
          true,
        );
        if (contextRef.current !== requestContext) return;
        onApply?.(entries.map(entry => ({ ...entry,targetFormKey: targetsRef.current[0].key })));
        setFilled(
          outcome.result.fields
            .filter((field) => (field.role ?? "entry") === "entry" && field.value != null)
            .map((field) => `${field.label} ${field.value}`),
        );
        await refresh();
        return;
      }

      const rows: ReviewRow[] = outcome.result.fields
        .filter((field) => (field.role ?? "entry") === "entry")
        .map((field) => ({
          fieldId: field.fieldId,
          unitId: field.unitId,
          fieldKey: field.fieldKey,
          label: field.label,
          value: typeof field.value === "number" ? field.value : null,
          status: field.status,
          box: field.box,
          cropUrl: outcome.crops[field.fieldId] ?? null,
        }));

      const blob = await new Promise<Blob | null>((resolve) =>
        outcome.prepared.canvas.toBlob((value) => resolve(value), "image/jpeg", 0.85),
      );
      if (contextRef.current !== requestContext) return;
      setReview({
        context: requestContext,
        outcome,
        sourceImageId: uploaded.id,
        imageUrl: blob ? URL.createObjectURL(blob) : URL.createObjectURL(file),
        rows: rows.map(routeRow),
        warnings: [...judged.reasons, ...outcome.result.warnings],
      });
    } catch (e) {
      if (contextRef.current === requestContext) setError(e instanceof Error ? e.message : "画像を送れませんでした");
    } finally {
      busyRef.current = false;
      setBusy(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  /** 読み取りの記録を残す。本人が確認した値だけを採用版にする */
  const saveReading = async (current: Review, adopted: boolean) => {
    const { outcome } = current;
    await apiFetch("/api/reports/source-images/readings", {
      method: "POST",
      body: JSON.stringify({
        sourceImageId: current.sourceImageId,
        templateKey: outcome.template?.key ?? null,
        templateVersion: outcome.template?.version ?? null,
        extracted: {
          rotation: outcome.rotation,
          score: outcome.result?.match.score ?? null,
          level: outcome.result?.match.level ?? null,
          trust: outcome.result?.trust ?? null,
          readDate: outcome.result?.readDate ?? null,
          fields: (outcome.result?.fields ?? []).map((field) => ({
            fieldId: field.fieldId,
            value: field.value,
            status: field.status,
            confidence: Number(field.confidence.toFixed(2)),
          })),
        },
        corrected: adopted
          ? {
              fields: current.rows.filter(row => row.included !== false).map((row) => ({
                fieldId: row.fieldId,
                targetFormKey: row.targetFormKey ?? null,
                unitId: row.unitId,
                fieldKey: row.fieldKey,
                value: row.value,
              })),
            }
          : null,
        adopted,
      }),
    });
  };

  const confirmReview = async () => {
    if (!review || review.context !== contextRef.current) return;
    const chosen = review.rows.filter(row => row.included);
    if (new Set(chosen.map(row => JSON.stringify([row.targetFormKey,row.unitId,row.fieldKey]))).size !== chosen.length) return;
    if (!chosen.length || chosen.some(row => row.value == null || !Number.isFinite(row.value) || row.value < 0 || !targetsRef.current.some(target => target.key === row.targetFormKey && target.fields.some(field => field.unitId === row.unitId && field.fieldKey === row.fieldKey)))) return;
    setSaving(true);
    try {
      await saveReading(review, true);
      if (review.context !== contextRef.current) return;
      const entries = chosen.map(row => ({ unitId: row.unitId,fieldKey: row.fieldKey,value: row.value as number,targetFormKey: row.targetFormKey }));
      onApply?.(entries);
      setFilled([...new Set(chosen.map(row => targetsRef.current.find(target => target.key === row.targetFormKey)?.label).filter((label): label is string => !!label))]);
      if (review.imageUrl) URL.revokeObjectURL(review.imageUrl);
      setReview(null);
      await refresh();
    } catch {
      setError("確認した値を保存できませんでした");
    } finally {
      setSaving(false);
    }
  };

  const cancelReview = async () => {
    if (!review) return;
    // 読んだ記録だけは残す（採用しない）。原本は提出済みのまま
    void saveReading(review, false).catch(() => { if(review.context === contextRef.current) setError("読み取りの記録を保存できませんでした。"); });
    if (review.imageUrl) URL.revokeObjectURL(review.imageUrl);
    setReview(null);
    await refresh();
  };

  return (
    <section
      className={`rounded-lg border bg-white p-4 transition-colors ${dragging ? "border-amber-500 bg-amber-50" : "border-slate-200"}`}
      aria-label="配完表の画像"
      onDragEnter={(event) => {
        if (event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
          setDragging(true);
        }
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) event.preventDefault();
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        const file = event.dataTransfer.files[0];
        if (file && !busy) void handleFile(file);
      }}
    >
      <div className="mb-2 flex items-center gap-2">
        <FontAwesomeIcon icon={faImage} className="h-3.5 w-3.5 text-slate-400" />
        <h3 className="text-sm font-medium text-slate-800">配完表の画像</h3>
      </div>

      {images.length > 0 && (
        <ul className="mb-3 divide-y divide-slate-100">
          {images.map((image) => (
            <li key={image.id} className="flex items-center gap-2 py-1.5 text-xs">
              <FontAwesomeIcon
                icon={image.status === "confirmed" ? faCircleCheck : faImage}
                className={`h-3 w-3 ${image.status === "confirmed" ? "text-emerald-600" : "text-slate-400"}`}
              />
              <span className="min-w-0 flex-1 truncate text-slate-700">{image.original_filename || "画像"}</span>
              {image.status === "confirmed" && <span className="text-emerald-700">読み取り確認済み</span>}
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
          if (file) void handleFile(file);
        }}
      />
      <Button
        variant="outline"
        size="touch"
        className="w-full"
        disabled={busy != null || saving || review != null}
        onClick={() => inputRef.current?.click()}
      >
        {busy ?? (canRead ? "画像から入力" : images.length > 0 ? "画像を追加" : "画像を選ぶ")}
      </Button>
      <p className="mt-2 text-center text-xs text-slate-500">スクリーンショットをここにドロップ</p>

      {filled.length > 0 && (
        <p className="mt-2 text-xs text-emerald-700">
          <FontAwesomeIcon icon={faCircleCheck} className="mr-1 h-3 w-3" />
          画像から入力しました（{filled.join("・")}）
        </p>
      )}

      {error && (
        <p role="alert" className="mt-2 text-xs text-red-600">
          <FontAwesomeIcon icon={faTriangleExclamation} className="mr-1 h-3 w-3" />
          {error}
        </p>
      )}

      {review && (
        <ReportImageReviewSheet
          targets={targets}
          onTargetChange={(fieldId,key) => setReview(prev => prev ? { ...prev,rows: prev.rows.map(row => row.fieldId === fieldId ? { ...row,targetFormKey: key } : row) } : prev)}
          onIncludeChange={(fieldId,included) => setReview(prev => prev ? { ...prev,rows: prev.rows.map(row => row.fieldId === fieldId ? { ...row,included } : row) } : prev)}
          templateName={review.outcome.template?.name ?? ""}
          imageUrl={review.imageUrl}
          imageWidth={review.outcome.prepared.width}
          imageHeight={review.outcome.prepared.height}
          rows={review.rows}
          warnings={review.warnings}
          trust={review.outcome.result?.trust ?? EMPTY_TRUST}
          saving={saving}
          onChange={(fieldId, value) =>
            setReview((prev) =>
              prev
                ? { ...prev, rows: prev.rows.map((row) => (row.fieldId === fieldId ? { ...row, value } : row)) }
                : prev,
            )
          }
          onCancel={() => void cancelReview()}
          onConfirm={() => void confirmReview()}
        />
      )}
    </section>
  );
}
