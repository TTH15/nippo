import type { ShiftRequest, PeriodInfo } from "@repo/core/types";
// 両プレビューで共用。サーバーの月単位置換・締切保護をメモリ内で再現する。
const saved = new Map<string, ShiftRequest[]>();
export const previewRequestSlots = [{ id: "morning", name: "午前便" }, { id: "afternoon", name: "午後便" }];
let scenario = "normal";
export function setRequestScenario(value: string) { scenario = value; }
export function requestPeriods(month: string): PeriodInfo[] {
  if (scenario === "deadline-error") throw new Error("提出期間を取得できませんでした");
  const [y, m] = month.split("-").map(Number);
  return [{ seq: 1, label: `1〜${new Date(y, m, 0).getDate()}`, startDate: `${month}-01`, endDate: `${month}-${new Date(y, m, 0).getDate()}`, deadline: `${month}-25`, closed: scenario === "closed" }];
}
export function previewRequests(month: string) {
  if (!saved.has(month)) saved.set(month, [
    { id: `off-${month}-2`, driver_id: "preview-driver", request_date: `${month}-02`, request_type: "OFF", slot_id: null },
    { id: `off-${month}-9`, driver_id: "preview-driver", request_date: `${month}-09`, request_type: "OFF", slot_id: "afternoon" },
  ]);
  return saved.get(month)!.map(r => ({ ...r }));
}
export function savePreviewRequests(month: string, entries: { date: string; slotId: string | null }[]) {
  if (scenario === "send-error") throw new Error("提出できませんでした。もう一度お試しください。");
  const locked = requestPeriods(month).some(p => p.closed);
  if (locked) throw new Error("受付を終了しています");
  saved.set(month, entries.filter(e => e.date.startsWith(`${month}-`) && (e.slotId === null || previewRequestSlots.some(s => s.id === e.slotId))).map((e, i) => ({ id: `off-${month}-${i}`, driver_id: "preview-driver", request_date: e.date, request_type: "OFF", slot_id: e.slotId })));
  return { ok: true };
}
