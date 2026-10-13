import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows, IN_CLAUSE_BATCH_SIZE } from "@/server/aggregation/pagination";
import { isVehicleNumberField, vehicleNumberText, type ReportVehicleNumber } from "@/lib/reportVehicleNumber";

type Report = { id: string; driver_id: string; report_date: string; course_id: string | null; vehicles?: { number_numeric?: string | null } | null };
type Image = { id: string; driver_id: string; report_date: string; course_id: string | null; supersedes_id: string | null };
type Reading = { source_image_id: string; template_key: string | null; template_version: string | null;
  adopted: boolean; confirmed_at: string | null; extracted: unknown; corrected: unknown; created_at: string };
type Template = { template_key: string; version: number; definition: { fields?: { id: string; fieldKey: string; label: string }[] } };
const identity = (row: Report | Image) => JSON.stringify([row.driver_id, row.report_date, row.course_id]);
function fields(value: unknown): { fieldId: string; value: unknown }[] {
  if (!value || typeof value !== "object") return [];
  const result = (value as { fields?: unknown }).fields;
  return Array.isArray(result) ? result.filter(row => row && typeof row.fieldId === "string") : [];
}

export function matchVehicleNumberEvidence(reports: Report[], images: Image[], readings: Reading[], templates: Template[]) {
  const result = new Map<string, ReportVehicleNumber>();
  const superseded = new Set(images.map(image => image.supersedes_id).filter(Boolean));
  for (const report of reports) {
    // 原本にはreport FKや便番号が無い。日/人/コースが曖昧なら別便の番号を推測しない。
    if (reports.filter(other => identity(other) === identity(report)).length !== 1) continue;
    const ownImages = images.filter(image => !superseded.has(image.id) && identity(image) === identity(report));
    if (ownImages.length !== 1) continue;
    const own = readings.filter(reading => reading.source_image_id === ownImages[0].id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    const reading = own.find(row => row.adopted && row.confirmed_at) ?? own[0];
    if (!reading) continue;
    const template = templates.find(row => row.template_key === reading.template_key && String(row.version) === String(reading.template_version));
    if (!template || !Array.isArray(template.definition?.fields)) continue;
    const numberFields = template.definition.fields.filter(field => isVehicleNumberField(field.fieldKey, field.label));
    const corrected = fields(reading.corrected), extracted = fields(reading.extracted);
    const confirmed = !!(reading.adopted && reading.confirmed_at);
    const values = numberFields.map(field => {
      const correction = confirmed ? corrected.find(row => row.fieldId === field.id) : undefined;
      // 明示的な空欄訂正を古いOCRで埋め戻さない。
      return { number: vehicleNumberText(correction ? correction.value : extracted.find(row => row.fieldId === field.id)?.value),
        source: correction ? "confirmed_image" as const : "ocr" as const };
    }).filter((row): row is { number: string; source: "confirmed_image" | "ocr" } => !!row.number);
    if (values.length && new Set(values.map(row => row.number)).size === 1) result.set(report.id, values[0]);
  }
  return result;
}

export async function loadVehicleNumberEvidence(db: SupabaseClient, orgId: string, reports: Report[]) {
  if (!reports.length || reports.every(row => row.vehicles?.number_numeric)) return { values: new Map<string, ReportVehicleNumber>(), unavailable: false };
  try {
    const dates = [...new Set(reports.map(row => row.report_date))], images: Image[] = [];
    for (let i = 0; i < dates.length; i += IN_CLAUSE_BATCH_SIZE) {
      images.push(...await fetchAllRows<Image>((from, to) => db.from("report_source_images")
        .select("id, driver_id, report_date, course_id, supersedes_id").eq("org_id", orgId)
        .in("report_date", dates.slice(i, i + IN_CLAUSE_BATCH_SIZE)).order("id").range(from, to)));
    }
    const relevant = images.filter(image => reports.some(report => identity(report) === identity(image)));
    const readings: Reading[] = [];
    for (let i = 0; i < relevant.length; i += IN_CLAUSE_BATCH_SIZE) {
      readings.push(...await fetchAllRows<Reading>((from, to) => db.from("report_source_image_readings")
        .select("source_image_id, template_key, template_version, adopted, confirmed_at, extracted, corrected, created_at")
        .eq("org_id", orgId).in("source_image_id", relevant.slice(i, i + IN_CLAUSE_BATCH_SIZE).map(row => row.id))
        .order("created_at").order("id").range(from, to)));
    }
    const keys = [...new Set(readings.map(row => row.template_key).filter((key): key is string => !!key))], templates: Template[] = [];
    for (let i = 0; i < keys.length; i += IN_CLAUSE_BATCH_SIZE) {
      templates.push(...await fetchAllRows<Template>((from, to) => db.from("report_image_templates")
        .select("template_key, version, definition").eq("org_id", orgId)
        .in("template_key", keys.slice(i, i + IN_CLAUSE_BATCH_SIZE)).order("template_key").order("version").range(from, to)));
    }
    return { values: matchVehicleNumberEvidence(reports, relevant, readings, templates), unavailable: false };
  } catch {
    // 古いschema/通信失敗でも提出済み日報と既存車番を消さない。
    return { values: new Map<string, ReportVehicleNumber>(), unavailable: true };
  }
}
