// ============================================================
// 原本画像の様式（どの画面の、どの位置に、どの報告項目の数字があるか）。
// 設計: docs/design/report-image-evidence-2026-09.md（RIMG-1 / RIMG-3）
//
// ここが守ること:
//   - 様式の中身は @repo/core の検査を通す（壊れた定義を保存しない）
//   - 報告項目の紐付けは**自社のもの**に限る（他社の unit / field を指せない）
//   - 運用中(active)にできるのは、全項目が報告項目へ結び付いた様式だけ
//   - 版を分ける。確定済みの日報を別の版で読み直して上書きしない
// ============================================================
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  validateTemplateDefinition,
  type ImageTemplate,
  type ImageTemplateDefinition,
} from "@repo/core/logic/reportImageTemplate";

export const TEMPLATE_SAMPLE_BUCKET = "report-image-template-samples";
export const TEMPLATE_SAMPLE_MIME = ["image/jpeg", "image/png"];
export const TEMPLATE_SAMPLE_MAX_BYTES = 20 * 1024 * 1024;

export type TemplateRow = {
  id: string;
  carrier_id: string | null;
  template_key: string;
  version: number;
  name: string;
  status: "draft" | "active" | "retired";
  definition: ImageTemplateDefinition;
  sample_storage_path: string | null;
  sample_width: number | null;
  sample_height: number | null;
  note: string | null;
  updated_at: string;
};

/** 読み取り側へ渡す形（見本の画像は含めない） */
export function toImageTemplate(row: TemplateRow): ImageTemplate {
  return {
    key: row.template_key,
    version: String(row.version),
    name: row.name,
    carrierId: row.carrier_id,
    definition: row.definition,
  };
}

const KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{1,59}$/;

export type TemplateInput = {
  templateKey: string;
  name: string;
  carrierId: string | null;
  note: string | null;
  definition: ImageTemplateDefinition;
};

export type ParseResult = { ok: true; value: TemplateInput } | { ok: false; errors: string[] };

/**
 * 入力の形を検査する。報告項目が自社のものかは別途 DB で確かめる。
 * 編集中（下書き）は見出しや項目が揃っていなくても保存できる。運用中にするときに全部見る。
 */
export function parseTemplateInput(raw: unknown, options: { allowEmpty?: boolean } = {}): ParseResult {
  if (!raw || typeof raw !== "object") return { ok: false, errors: ["様式の内容を確認してください"] };
  const body = raw as Record<string, unknown>;
  const errors: string[] = [];

  const templateKey = typeof body.templateKey === "string" ? body.templateKey.trim().toLowerCase() : "";
  if (!KEY_PATTERN.test(templateKey)) errors.push("様式の識別子は英小文字・数字・ハイフンで2文字以上にしてください");

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 80) errors.push("様式の名前を80文字以内で入れてください");

  const note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 500) : null;
  const carrierId = typeof body.carrierId === "string" && body.carrierId ? body.carrierId : null;

  errors.push(...validateTemplateDefinition(body.definition, options));
  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: { templateKey, name, carrierId, note, definition: body.definition as ImageTemplateDefinition },
  };
}

/**
 * 様式が指している報告項目が自社のものか確かめる。
 * 他社の unit / field を指した様式を保存させない（値の流出も混入も防ぐ）。
 */
export async function verifyBindings(
  db: SupabaseClient,
  orgId: string,
  definition: ImageTemplateDefinition,
): Promise<string[]> {
  const entries = (definition.fields ?? []).filter((field) => (field.role ?? "entry") === "entry");
  const unitIds = Array.from(new Set(entries.map((field) => field.unitId).filter(Boolean)));
  if (unitIds.length === 0) return [];

  const { data: carriers, error: carrierError } = await db.from("carriers").select("id").eq("org_id", orgId);
  if (carrierError) return ["報告項目を確認できませんでした"];
  const carrierIds = (carriers ?? []).map((row) => row.id as string);
  if (carrierIds.length === 0) return ["報告項目が登録されていません"];

  const { data: units, error: unitError } = await db
    // tenant-scope-ok: carrierIds は org 絞りで作った集合
    .from("units")
    .select("id, carrier_id")
    .in("id", unitIds)
    .in("carrier_id", carrierIds);
  if (unitError) return ["報告項目を確認できませんでした"];
  const ownUnits = new Set((units ?? []).map((row) => row.id as string));

  const { data: fields, error: fieldError } = await db
    // tenant-scope-ok: unitIds は上で自社所属を確かめた集合
    .from("unit_fields")
    .select("unit_id, field_key")
    .in("unit_id", Array.from(ownUnits));
  if (fieldError) return ["報告項目を確認できませんでした"];
  const ownFields = new Set((fields ?? []).map((row) => `${row.unit_id}:${row.field_key}`));

  const errors: string[] = [];
  for (const field of entries) {
    if (!ownUnits.has(field.unitId)) {
      errors.push(`${field.label}に選んだ報告単位は使えません`);
      continue;
    }
    if (!ownFields.has(`${field.unitId}:${field.fieldKey}`)) {
      errors.push(`${field.label}に選んだ報告項目が見つかりません`);
    }
  }
  return errors;
}

/** 運用中にできるか。未束縛の項目が残ったまま本番で使わせない */
export function readyForActivation(definition: ImageTemplateDefinition): string[] {
  const errors = validateTemplateDefinition(definition);
  if ((definition.match?.required ?? []).length === 0) errors.push("様式を見分ける見出しを決めてください");
  const entries = (definition.fields ?? []).filter((field) => (field.role ?? "entry") === "entry");
  if (entries.length === 0) errors.push("日報へ入れる項目がありません");
  for (const field of entries) {
    if (!field.unitId || !field.fieldKey) errors.push(`${field.label}の報告項目を決めてください`);
  }
  if (!definition.sample) errors.push("見本画像を登録してください");
  return Array.from(new Set(errors));
}
