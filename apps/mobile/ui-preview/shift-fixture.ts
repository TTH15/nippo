import { previewRequests, previewRequestSlots } from "./shift-request-fixture";
import type { MeShift, MeShiftsResponse } from "@repo/core/types";
import { previewVehicle } from "./vehicle";
import { previewHomeCourse } from "./home-course";

export function previewShifts(month: string): MeShiftsResponse {
  const date = (day: number) => `${month}-${String(day).padStart(2, "0")}`;
  const shift = (day: number, changes: Partial<MeShift> = {}): MeShift => ({
    shift_date: date(day), course_name: "中央", course_full_name: "京都中央エリア・四条烏丸から西院方面の配送コース",
    course_color: previewHomeCourse.color, slot: 1, cycle_label: "午前便", meeting_place: "中央配送センター 東側入口",
    meeting_time: "07:30:00", end_time: "16:30:00", vehicle: { ...previewVehicle, manufacturer: "スズキ", brand: "エブリイ" }, ...changes,
  });
  return { shifts: [shift(9), shift(15), shift(15, { course_name: "西", course_full_name: "西京区・洛西ニュータウン定期配送", course_color: "#95713C", slot: 2, cycle_label: "夕方便", meeting_time: "17:00", end_time: "20:00", vehicle: null }), shift(24), shift(25, { meeting_time: null, end_time: null, meeting_place: null, vehicle: null, uses_external_vehicle: true })], rest_days: [
    ...previewRequests(month).map(r => ({ date: r.request_date, kind: "requested" as const, ...(r.slot_id ? { slot_label: previewRequestSlots.find(s => s.id === r.slot_id)?.name || "一部の便" } : {}) })),
  ] };
}
