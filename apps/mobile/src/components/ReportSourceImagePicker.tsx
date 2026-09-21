import { useEffect, useState } from "react";
import { View, Text, Pressable, ActivityIndicator, Alert } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { apiFetch, apiUpload } from "@repo/core/api";
import { capturedAtFromPicked } from "@repo/core/logic/imageCapturedAt";
import {
  canSkipReview,
  judgeSourceImageDay,
  type ImageTemplate,
  type ReadTrust,
  type SourceImageDuplicate,
} from "@repo/core/logic/reportImageTemplate";
import { readReportImage, type ReportImageOutcome } from "../ocr/reportImageReader";
import { ReportImageReviewSheet, type ReviewRow } from "./ReportImageReviewSheet";

// ============================================================
// 日報に配完表などの原本画像を添える（モバイル）。
// 設計: docs/design/report-image-evidence-2026-09.md（RIMG-2 / RIMG-5）
//
// ★写真は**選んだものをそのまま送る**（圧縮・切り抜き・回転をしない）。
// ★Webと違い、写真の作成日時が取れる。取れたら送り、取れなければ「不明」のまま送る
//   （現在時刻で埋めない）。サーバーはファイルの中身からも日時を読み直す。
// ★件数の読み取りは端末の中だけで行う（ML Kit＋画像の切り出し）。画像は外へ出ない。
//   読めた値は本人が確認してから日報へ入れる。読めない欄は空のままにする（0で埋めない）。
// ============================================================

type SourceImage = { id: string; status: string; original_filename: string | null; byte_size: number };
type UploadResponse = {
  id: string;
  duplicate: SourceImageDuplicate;
  capturedAt: string | null;
  capturedAtSource: "exif" | "photo_library" | "unknown";
};

const MAX_BYTES = 20 * 1024 * 1024;

const EMPTY_TRUST: ReadTrust = { level: "suspect", checksRun: 0, checksFailed: 0, incomplete: true, reasons: [] };

const STATUS_LABEL: Record<string, string> = {
  received: "提出済み",
  needs_review: "件数の確定待ち",
  confirmed: "件数入力済み",
  unsupported: "手入力",
  failed: "読み取り失敗",
};

export type ReportImageEntry = { unitId: string; fieldKey: string; value: number };

type Review = {
  outcome: ReportImageOutcome;
  sourceImageId: string;
  rows: ReviewRow[];
  warnings: string[];
};

export function ReportSourceImagePicker({
  date,
  courseId,
  onApply,
}: {
  date: string;
  courseId?: string | null;
  onApply?: (entries: ReportImageEntry[]) => void;
}) {
  const [images, setImages] = useState<SourceImage[]>([]);
  const [templates, setTemplates] = useState<ImageTemplate[]>([]);
  // 件数が報酬に効かないコースは、確認を省く設定にできる（migration 182）
  const [autoFillCourses, setAutoFillCourses] = useState<string[]>([]);
  const [filled, setFilled] = useState<string[]>([]);
  const [available, setAvailable] = useState(true);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [notes, setNotes] = useState<string[]>([]);
  const [review, setReview] = useState<Review | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const response = await apiFetch<{ images: SourceImage[]; unavailable?: boolean }>(
        `/api/reports/source-images?date=${date}`,
      );
      setImages(response.images ?? []);
      setAvailable(!response.unavailable);
    } catch {
      setAvailable(false);
    }
  };

  useEffect(() => {
    void load();
    // 運用中の様式（読み取りの決め）。1件も無ければ原本を残すだけになる
    apiFetch<{ templates: ImageTemplate[]; autoFillCourseIds?: string[] }>("/api/me/report-image-templates")
      .then((response) => {
        setTemplates(response.templates ?? []);
        setAutoFillCourses(response.autoFillCourseIds ?? []);
      })
      .catch(() => setTemplates([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  if (!available) return null;

  const pick = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("写真を選べません", "設定から写真へのアクセスを許可してください。");
      return;
    }
    // 原本をそのまま送るため、編集・圧縮はしない。作成日時のために exif を取る
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 1,
      exif: true,
    });
    if (picked.canceled || !picked.assets?.[0]) return;
    const asset = picked.assets[0];
    if (asset.fileSize != null && asset.fileSize > MAX_BYTES) {
      Alert.alert("画像が大きすぎます", `${Math.floor(MAX_BYTES / (1024 * 1024))}MBまでの画像を選んでください。`);
      return;
    }

    setBusy(true);
    setNotes([]);
    setFilled([]);
    try {
      const captured = capturedAtFromPicked(
        (asset.exif as Record<string, unknown> | null) ?? null,
        // 写真ライブラリの作成時刻（取れる端末だけ）。撮影日時の証明としては扱わない
        typeof (asset as { creationTime?: number }).creationTime === "number"
          ? (asset as { creationTime?: number }).creationTime
          : null,
      );

      const form = new FormData();
      // RN の FormData はファイルを {uri, name, type} で受け取る
      form.append("file", {
        uri: asset.uri,
        name: asset.fileName ?? "report.jpg",
        type: asset.mimeType ?? "image/jpeg",
      } as unknown as Blob);
      form.append(
        "meta",
        JSON.stringify({
          reportDate: date,
          courseId: courseId ?? null,
          clientKey: `${date}-${Date.now()}`,
          originalFilename: asset.fileName ?? null,
          capturedAt: captured.capturedAt,
          capturedAtSource: captured.source,
          width: asset.width ?? null,
          height: asset.height ?? null,
        }),
      );

      setStep(templates.length > 0 ? "画像を読んでいます" : "送信中…");
      // 様式は読む瞬間に取り直す。開きっぱなしの画面が、差し替え前の古い様式で読まないようにする
      const fresh = await apiFetch<{ templates: ImageTemplate[]; autoFillCourseIds?: string[] }>(
        "/api/me/report-image-templates",
      ).catch(() => null);
      const latestTemplates = fresh?.templates ?? templates;
      if (fresh?.autoFillCourseIds) setAutoFillCourses(fresh.autoFillCourseIds);
      // 原本の送信と読み取りは同時に走らせる。送信の待ち時間ぶん読み取りが遅れないようにする
      const reading =
        latestTemplates.length > 0
          ? readReportImage(asset.uri, latestTemplates, { reportDate: date, onStep: (value) => setStep(value) })
          : Promise.resolve(null);
      const uploaded = await apiUpload<UploadResponse>("/api/reports/source-images", form);
      await load();

      if (latestTemplates.length === 0) {
        setNotes(
          judgeSourceImageDay({
            reportDate: date,
            capturedAt: uploaded.capturedAt,
            capturedAtSource: uploaded.capturedAtSource,
            readDate: null,
            duplicate: uploaded.duplicate,
          }).reasons,
        );
        return;
      }

      const outcome = await reading;
      if (!outcome || !outcome.template || !outcome.result) {
        setNotes(["この画像からは件数を読み取れません。件数は手入力してください"]);
        return;
      }
      const judged = judgeSourceImageDay({
        reportDate: date,
        capturedAt: uploaded.capturedAt,
        capturedAtSource: uploaded.capturedAtSource,
        readDate: outcome.result.readDate,
        duplicate: uploaded.duplicate,
      });
      setNotes([]);

      const rows = outcome.result.fields
        .filter((field) => (field.role ?? "entry") === "entry")
        .map((field) => ({
          fieldId: field.fieldId,
          unitId: field.unitId,
          fieldKey: field.fieldKey,
          label: field.label,
          value: typeof field.value === "number" ? field.value : null,
          status: field.status,
          cropUri: outcome.crops[field.fieldId] ?? null,
        }));
      const entries = rows
        .filter((row) => row.value != null && row.unitId && row.fieldKey)
        .map((row) => ({ unitId: row.unitId, fieldKey: row.fieldKey, value: row.value as number }));
      const courseAllowsSkip = !!courseId && autoFillCourses.includes(courseId);

      // 裏が取れている読み取り、または確認を省く設定のコースは、見比べずにそのまま入れる
      if (canSkipReview(outcome.result.trust, { courseAllowsSkip }) && entries.length > 0) {
        onApply?.(entries);
        await saveReading({ outcome, sourceImageId: uploaded.id, rows, warnings: [] }, true);
        setFilled(rows.filter((row) => row.value != null).map((row) => `${row.label} ${row.value}`));
        await load();
        return;
      }

      setReview({
        outcome,
        sourceImageId: uploaded.id,
        warnings: [...judged.reasons, ...outcome.result.warnings],
        rows,
      });
    } catch (error) {
      Alert.alert("送れませんでした", error instanceof Error ? error.message : "もう一度お試しください。");
    } finally {
      setBusy(false);
      setStep("");
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
              fields: current.rows.map((row) => ({
                fieldId: row.fieldId,
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
    if (!review) return;
    setSaving(true);
    try {
      await saveReading(review, true);
      onApply?.(
        review.rows
          .filter((row) => row.value != null && row.unitId && row.fieldKey)
          .map((row) => ({ unitId: row.unitId, fieldKey: row.fieldKey, value: row.value as number })),
      );
      setReview(null);
      await load();
    } catch (error) {
      Alert.alert("保存できませんでした", error instanceof Error ? error.message : "もう一度お試しください。");
    } finally {
      setSaving(false);
    }
  };

  const cancelReview = async () => {
    if (!review) return;
    void saveReading(review, false);
    setReview(null);
    await load();
  };

  return (
    <View className="gap-2 rounded-xl border border-brand-200 bg-white p-4">
      <Text className="text-base font-semibold text-brand-900">配完表の画像</Text>

      {images.map((image) => (
        <View key={image.id} className="flex-row items-center gap-2">
          <Text className="flex-1 text-sm text-brand-700" numberOfLines={1}>
            {image.original_filename || "画像"}
          </Text>
          <Text className="text-xs text-brand-500">{STATUS_LABEL[image.status] ?? image.status}</Text>
        </View>
      ))}

      {filled.length > 0 ? (
        <Text className="text-xs text-accent-600">画像から入力しました（{filled.join("・")}）</Text>
      ) : null}

      {notes.map((note) => (
        <Text key={note} className="text-xs text-amber-700">
          {note}
        </Text>
      ))}

      <Pressable
        onPress={() => void pick()}
        disabled={busy}
        className="min-h-12 flex-row items-center justify-center rounded-lg border border-brand-300 px-4"
      >
        {busy ? (
          <View className="flex-row items-center gap-2">
            <ActivityIndicator />
            {step ? <Text className="text-sm text-brand-600">{step}</Text> : null}
          </View>
        ) : (
          <Text className="text-base font-medium text-brand-800">
            {templates.length > 0 ? "画像から入力" : images.length > 0 ? "画像を追加" : "画像を選ぶ"}
          </Text>
        )}
      </Pressable>

      {review && (
        <ReportImageReviewSheet
          visible
          templateName={review.outcome.template?.name ?? ""}
          imageUri={review.outcome.prepared.uri}
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
    </View>
  );
}
