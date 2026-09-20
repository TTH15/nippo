// ============================================================
// 管理側で原本画像と読み取りを確認するための組み立て。
// 設計: docs/design/report-image-evidence-2026-09.md（RIMG-4）
//
// ここが守ること:
//   - 読み取った値（extracted）と本人が確認した値（corrected）を並べて見せる。片方に潰さない
//   - 集計へ渡ったのは adopted の1版だけ。読み取っただけの値と混ぜない
//   - 同じ画像の使い回しは「確認の材料」として出す。ここで良し悪しの判定はしない
//   - 原本そのものは署名URLで別に渡す（一覧に画像を載せない）
// ============================================================
import {
  judgeSourceImageDay,
  type ImageTemplateDefinition,
  type SourceImageDuplicate,
} from "@repo/core/logic/reportImageTemplate";

export type ReviewImageRow = {
  id: string;
  driverId: string;
  reportDate: string;
  sha256: string;
};

/**
 * 同じ中身の原本がどう使われているかを見る。
 * 別人・別日で同じ画像が出ていれば、その行すべてに印を付ける（どちらが先かは判定しない）。
 */
export function flagDuplicates(rows: readonly ReviewImageRow[]): Record<string, SourceImageDuplicate> {
  const groups = new Map<string, ReviewImageRow[]>();
  for (const row of rows) {
    const group = groups.get(row.sha256) ?? [];
    group.push(row);
    groups.set(row.sha256, group);
  }
  const flags: Record<string, SourceImageDuplicate> = {};
  for (const group of groups.values()) {
    for (const row of group) {
      const others = group.filter((other) => other.id !== row.id);
      if (others.length === 0) {
        flags[row.id] = "none";
      } else if (others.some((other) => other.driverId !== row.driverId)) {
        flags[row.id] = "other_driver";
      } else if (others.some((other) => other.reportDate !== row.reportDate)) {
        flags[row.id] = "other_date";
      } else {
        flags[row.id] = "same_image";
      }
    }
  }
  return flags;
}

export type ExtractedField = { fieldId: string; value: number | string | null; status?: string; confidence?: number };
export type CorrectedField = { fieldId: string; unitId?: string; fieldKey?: string; value: number | string | null };

export type ReviewValue = {
  fieldId: string;
  /** 様式から引いた表示名。様式が消えていれば null */
  label: string | null;
  read: number | string | null;
  confirmed: number | string | null;
  status: string | null;
  confidence: number | null;
  /** 本人が読み取り値を直したか */
  corrected: boolean;
};

/**
 * 読み取り値と確認後の値を項目ごとに並べる。
 * 様式（その版）から表示名を引く。様式が消えていても値は出す。
 */
export function mergeReadingValues(
  extracted: unknown,
  corrected: unknown,
  definition: ImageTemplateDefinition | null,
): ReviewValue[] {
  const readFields = Array.isArray((extracted as { fields?: unknown })?.fields)
    ? ((extracted as { fields: ExtractedField[] }).fields ?? [])
    : [];
  const confirmedFields = Array.isArray((corrected as { fields?: unknown })?.fields)
    ? ((corrected as { fields: CorrectedField[] }).fields ?? [])
    : [];

  const labelOf = (fieldId: string): string | null =>
    definition?.fields?.find((field) => field.id === fieldId)?.label ?? null;

  const ids = Array.from(new Set([...readFields.map((f) => f.fieldId), ...confirmedFields.map((f) => f.fieldId)]));
  return ids.map((fieldId) => {
    const read = readFields.find((field) => field.fieldId === fieldId);
    const confirmed = confirmedFields.find((field) => field.fieldId === fieldId);
    const readValue = read?.value ?? null;
    const confirmedValue = confirmed ? (confirmed.value ?? null) : null;
    return {
      fieldId,
      label: labelOf(fieldId),
      read: readValue,
      confirmed: confirmedValue,
      status: read?.status ?? null,
      confidence: typeof read?.confidence === "number" ? read.confidence : null,
      // 確認後の値があり、読み取り値と違えば「直した」
      corrected: confirmed != null && String(confirmedValue ?? "") !== String(readValue ?? ""),
    };
  });
}

export type ReviewRowInput = {
  id: string;
  reportDate: string;
  status: string;
  capturedAt: string | null;
  capturedAtSource: "exif" | "photo_library" | "unknown";
  duplicate: SourceImageDuplicate;
  readDate: string | null;
  values: readonly ReviewValue[];
};

/** 管理が見るべき点だけを短く並べる。ここで提出の可否は決めない */
export function reviewReasons(input: ReviewRowInput): string[] {
  const judged = judgeSourceImageDay({
    reportDate: input.reportDate,
    capturedAt: input.capturedAt,
    capturedAtSource: input.capturedAtSource,
    readDate: input.readDate,
    duplicate: input.duplicate,
  });
  const reasons = [...judged.reasons];
  const corrected = input.values.filter((value) => value.corrected);
  if (corrected.length > 0) {
    reasons.push(`読み取りから直した項目が${corrected.length}件あります`);
  }
  if (input.status === "needs_review") reasons.push("件数が確定していません");
  if (input.status === "unsupported") reasons.push("様式に当てはまらず手入力になりました");
  return reasons;
}
