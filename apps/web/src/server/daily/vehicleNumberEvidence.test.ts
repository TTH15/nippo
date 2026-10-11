import { expect, it } from "vitest";
import { loadVehicleNumberEvidence, matchVehicleNumberEvidence } from "./vehicleNumberEvidence";
const report = { id: "r", driver_id: "d", report_date: "2026-09-01", course_id: "c" };
const image = { ...report, id: "img", supersedes_id: null };
const template = { template_key: "t", version: 1, definition: { fields: [{ id: "f", fieldKey: "vehicle_number", label: "車両番号" }] } };
const reading = { source_image_id: "img", template_key: "t", template_version: "1", adopted: false, confirmed_at: null, extracted: { fields: [{ fieldId: "f", value: "京都 480 り 12-34" }] }, corrected: null, created_at: "2026-09-01" };
it("過去の日報をその日/本人/コースの原本OCRと照合する", () => {
  expect(matchVehicleNumberEvidence([report], [image], [reading], [template]).get("r")).toEqual({ number: "京都 480 り 12-34", source: "ocr" });
});
it("確認された訂正値を優先し、空欄訂正をOCRで埋め戻さない", () => {
  const corrected = { ...reading, adopted: true, confirmed_at: "2026-09-02", corrected: { fields: [{ fieldId: "f", value: "5678" }] } };
  expect(matchVehicleNumberEvidence([report], [image], [corrected], [template]).get("r")).toEqual({ number: "5678", source: "confirmed_image" });
  expect(matchVehicleNumberEvidence([report], [image], [{ ...corrected, corrected: { fields: [{ fieldId: "f", value: null }] } }], [template]).size).toBe(0);
});
it("同日別便・複数原本・別人/別日/別コースへ番号を混ぜない", () => {
  expect(matchVehicleNumberEvidence([report, { ...report, id: "other", vehicles: { number_numeric: "9999" } }], [image], [reading], [template]).size).toBe(0);
  expect(matchVehicleNumberEvidence([report], [image, { ...image, id: "second" }], [reading], [template]).size).toBe(0);
  for (const patch of [{ driver_id: "other" }, { report_date: "2026-09-02" }, { course_id: null }]) expect(matchVehicleNumberEvidence([report], [{ ...image, ...patch }], [reading], [template]).size).toBe(0);
});
it("差し替え済み原本を除き、様式の番号欄以外を流用しない", () => {
  expect(matchVehicleNumberEvidence([report], [image, { ...image, id: "new", supersedes_id: "img" }], [reading], [template]).size).toBe(0);
  expect(matchVehicleNumberEvidence([report], [image], [reading], [{ ...template, definition: { fields: [{ id: "f", fieldKey: "meter", label: "メーター" }] } }]).size).toBe(0);
});
it("全読取りを会社で絞り、失敗しても確認待ちを返す（書込みなし）", async () => {
  const calls: { table: string; filters: unknown[] }[] = [];
  const tables: Record<string, unknown[]> = { report_source_images: [image], report_source_image_readings: [reading], report_image_templates: [template] };
  const db = { from(table: string) { const filters: unknown[] = []; calls.push({ table, filters }); const q: any = { select: () => q, eq: (key: string, value: unknown) => { filters.push([key, value]); return q; }, in: () => q, order: () => q, range: () => q, then: (resolve: any) => Promise.resolve({ data: tables[table] ?? [], error: null }).then(resolve) }; return q; } };
  expect((await loadVehicleNumberEvidence(db as any, "org-a", [report])).values.get("r")?.number).toContain("12-34");
  expect(calls).toHaveLength(3); for (const call of calls) expect(call.filters).toContainEqual(["org_id", "org-a"]);
  const failed = await loadVehicleNumberEvidence({ from() { throw Error("offline"); } } as any, "org-a", [report]); expect(failed.unavailable).toBe(true); expect(failed.values.size).toBe(0);
});
