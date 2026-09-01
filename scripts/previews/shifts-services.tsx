import { Fragment, useCallback, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { AdminPreviewLayout } from "../../apps/web/src/app/preview/driver-leases/AdminPreviewLayout";
import type { ShiftLease } from "../../apps/web/src/lib/shiftLease";
import { VehicleHandoffsPreview } from "../../apps/web/src/app/preview/vehicle-handoffs/VehicleHandoffsPreview";
import { sampleUses } from "../../apps/web/src/app/preview/vehicle-handoffs/model";

// All records below are fictional. This module has no network, database or authentication access.
const names = ["佐藤 翔太", "田中 美咲", "鈴木 大輔", "高橋 健太", "伊藤 彩", "渡辺 直樹", "山本 葵", "中村 拓海", "小林 悠斗", "加藤 真央", "吉田 亮", "山田 智子"];
const courses = [
  { id: "course-1", name: "豊中", summary_title: "豊中", color: "#fbbf24", max_drivers: 5, sort_order: 0, meeting_time: "07:30", slot_id: "slot-1" },
  { id: "course-2", name: "吹田", summary_title: "吹田", color: "#38bdf8", max_drivers: 5, sort_order: 1, meeting_time: "08:00", slot_id: "slot-1" },
  { id: "course-3", name: "北大阪", summary_title: "北大阪", color: "#34d399", max_drivers: 5, sort_order: 2, meeting_time: "08:30", slot_id: "slot-1" },
];
const drivers = names.map((name, i) => ({ id: `driver-${i + 1}`, name, list_no: i + 1, driver_courses: courses.map(c => ({ course_id: c.id })) }));
const vehicles = names.map((_, i) => ({ id: `vehicle-${i + 1}`, number_prefix: i % 2 ? "京都" : "大阪", number_class: "480", number_hiragana: i % 2 ? "れ" : "り", number_numeric: String(1201 + i * 517), plate_color: "black", ...(i === 0 ? { oil_change_interval: 5000, last_oil_change_mileage: 0, current_mileage: 5100 } : {}), ...(i === 11 ? { number_prefix: null, number_class: null, number_hiragana: null, number_numeric: null, manufacturer: "スズキ", brand: "エブリイ" } : {}) }));
type MockShift = { id: string; shift_date: string; course_id: string; cycle_no: number; slot: number; driver_id: string | null; vehicle_id?: string | null; uses_external_vehicle?: boolean; meeting_time?: string | null; vehicles?: unknown };
const periodData = new Map<string, { courses: typeof courses; drivers: typeof drivers; vehicles: typeof vehicles; shifts: MockShift[]; requests: unknown[]; slots: unknown[]; vehicle_driver_links: unknown[] }>();
const cache = new Map<string, unknown>();
const subscribers = new Set<() => void>();
let revision = 0;
let failNext = false;
let leaseScenario: "normal" | "empty" | "error" = "normal";
let firstDriverDaily = false;
let handoffScenario = false;
const leases: ShiftLease[] = drivers.flatMap((driver, i) => i % 3 === 2 ? [] : [{
  id: `lease-${i}`, driver_id: driver.id, mode: i % 3 === 0 ? "MONTHLY" : "DAILY", valid_from: "2020-01-01", valid_to: null,
}]);
// 8月から9月の契約変更を試す。過去の契約を現在の設定で上書きしない。
leases[0].valid_from = "2026-09-01";
leases.push({ id: "lease-past", driver_id: drivers[0].id, mode: "DAILY", valid_from: "2020-01-01", valid_to: "2026-08-31" });
export function setPreviewLeaseScenario(value: typeof leaseScenario) { leaseScenario = value; notify(); }
export function resetPreviewShifts() { periodData.clear(); leaseScenario = "normal"; firstDriverDaily = false; handoffScenario = false; failNext = false; notify(); }
function applyHandoffScenario(data: { shifts: MockShift[] }, start: string, end: string) {
  for (const use of sampleUses.filter(use => use.date >= start && use.date <= end)) {
    data.shifts = data.shifts.filter(shift => !(shift.shift_date === use.date && shift.driver_id === use.driverId));
    // 9/4は佐藤が別車両、田中が1201を使う架空の予定。通常車両の紐付けは変えない。
    data.shifts = data.shifts.map(shift => shift.shift_date === use.date && shift.vehicle_id === vehicles[0].id
      ? { ...shift, vehicle_id: vehicles[1].id, vehicles: vehicles[1] } : shift);
    data.shifts.push({ id: `handoff-${use.date}`, shift_date: use.date, course_id: use.courseId, cycle_no: use.cycleNo, slot: use.slot,
      driver_id: use.driverId, vehicle_id: vehicles[0].id, vehicles: vehicles[0], meeting_time: use.start });
  }
}
function seedHandoffScenario() {
  if (handoffScenario) return;
  handoffScenario = true;
  for (const [key, data] of periodData) {
    const params = new URLSearchParams(key.split("?")[1]);
    applyHandoffScenario(data, params.get("start")!, params.get("end")!);
  }
  notify();
}
function notify() { revision++; cache.clear(); subscribers.forEach(fn => fn()); }
function dataFor(key: string) {
  if (cache.has(key)) return cache.get(key);
  let data: unknown;
  if (key.startsWith("/api/admin/shifts?")) {
    if (!periodData.has(key)) {
      const params = new URLSearchParams(key.split("?")[1]);
      const start = params.get("start")!; const end = params.get("end")!;
      const shifts: MockShift[] = [];
      for (let day = Number(start.slice(-2)); day <= Number(end.slice(-2)); day++) {
        const date = `${start.slice(0, 8)}${String(day).padStart(2, "0")}`;
        drivers.forEach((driver, i) => {
          if ((day + i) % 7 === 0) return;
          shifts.push({ id: `${date}-${i}`, shift_date: date, course_id: courses[i % 3].id, cycle_no: 0, slot: Math.floor(i / 3) + 1, driver_id: driver.id, vehicle_id: vehicles[i].id, vehicles: vehicles[i] });
        });
      }
      periodData.set(key, { courses, drivers, vehicles, shifts, requests: [], slots: [{ id: "slot-1", name: "終日", start_time: null, end_time: null }], vehicle_driver_links: drivers.map((d, i) => ({ driver_id: d.id, vehicle_id: vehicles[i].id })) });
      if (handoffScenario) applyHandoffScenario(periodData.get(key)!, start, end);
    }
    data = { ...periodData.get(key)!, courses: handoffScenario ? courses.map(course => course.id === "course-3" ? { ...course, name: "京都上鳥羽", summary_title: "京都上鳥羽" } : course) : courses, driver_leases: leaseScenario === "error" ? null : leaseScenario === "empty" ? [] : leases.map(lease => firstDriverDaily && lease.driver_id === drivers[0].id ? { ...lease, mode: "DAILY" } : lease) };
  } else if (key.startsWith("/api/admin/spot-jobs?")) data = { jobs: [] };
  else if (key.endsWith("pending-changes")) data = { enabled: false, changes: [], canSend: false };
  else data = undefined;
  cache.set(key, data);
  return data;
}
export function useApi<T>(key: string | null) {
  const rev = useSyncExternalStore(useCallback(fn => { subscribers.add(fn); return () => subscribers.delete(fn); }, []), () => revision);
  const data = useMemo(() => key ? dataFor(key) as T : undefined, [key, rev]);
  const refresh = useCallback(async () => { await new Promise(resolve => setTimeout(resolve, 0)); leaseScenario = leaseScenario === "error" ? "normal" : leaseScenario; notify(); return key ? dataFor(key) as T : undefined; }, [key]);
  return { data, isInitialLoading: false, isLoading: false, error: undefined, mutate: refresh, refresh };
}
export async function apiFetch<T>(key: string, init?: RequestInit): Promise<T> {
  if (!init?.method || init.method === "GET") {
    if (key.includes("/history")) return { logs: [] } as T;
    if (key === "/api/admin/invoice-addresses") return { addresses: [] } as T;
    const data = dataFor(key);
    if (data !== undefined) return data as T;
    throw new Error("この設定は本番シフトUIの確認対象外です。外部通信は行っていません。");
  }
  if (failNext) { failNext = false; throw new Error("プレビューの保存失敗サンプル（外部送信なし）"); }
  const body = JSON.parse(String(init.body ?? "{}"));
  if (key === "/api/admin/shifts/driver-order") {
    const requestedOrder: string[] = Array.isArray(body.order) ? body.order.filter((id: unknown): id is string => typeof id === "string") : [];
    const rank = new Map<string, number>(requestedOrder.map((id, index) => [id, index]));
    drivers.sort((a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER));
    drivers.forEach((driver, index) => { driver.list_no = index + 1; });
    for (const data of periodData.values()) data.drivers = drivers;
    notify();
    return { ok: true } as T;
  }
  if (!["/api/admin/shifts", "/api/admin/shifts/vehicle", "/api/admin/shifts/times"].includes(key)) throw new Error("この操作はプレビューでは保存しません。外部通信は行っていません。");
  let changed: MockShift | undefined;
  for (const data of periodData.values()) {
    const index = data.shifts.findIndex(s => s.shift_date === body.shiftDate && s.course_id === body.courseId && s.slot === body.slot && s.cycle_no === (body.cycleNo ?? 0));
    const old = data.shifts[index];
    if (key === "/api/admin/shifts") {
      changed = { ...old, id: old?.id ?? `mock-${revision}`, shift_date: body.shiftDate, course_id: body.courseId, slot: body.slot, cycle_no: body.cycleNo ?? 0, driver_id: body.driverId };
    } else if (old) {
      changed = key.endsWith("/vehicle") ? { ...old, vehicle_id: body.vehicleId, vehicles: vehicles.find(v => v.id === body.vehicleId), uses_external_vehicle: body.usesExternalVehicle } : { ...old, meeting_time: body.meetingTime };
    }
    if (changed) { if (index >= 0) data.shifts[index] = changed; else data.shifts.push(changed); }
  }
  notify();
  return { shift: changed } as T;
}
export const getStoredDriver = () => ({ id: "preview-admin", name: "サンプル管理者" });
export const getToken = () => null;
export const hasCapability = (capability: string) => ["can_manage_shifts", "can_dispatch", "can_manage_vehicles"].includes(capability);
export const useCellCursors = () => ({ reportCell: () => {}, cellPeers: {}, peers: [] });
export const preload = async () => undefined;
export const mutate = async () => undefined;
export const swrFetcher = async () => undefined;
export const summarizeHistory = () => [];
// 本番PersonalShiftMemoBoardの読込形式を使う。プレビュー専用ユーザーの架空データだけを保存する。
function seedPreviewMemo(rowCount: number) {
  const lanes = Array.from({ length: rowCount }, (_, i) => {
    const course = courses[i % courses.length];
    return { id: i < courses.length ? `base-${course.id}` : `preview-lane-${i}`, routeId: course.id,
      name: `${course.name} ${Math.floor(i / courses.length) + 1}エリア`, color: course.color,
      activeWeekdays: [1, 2, 3, 4, 5, 6], requiredCount: 2, custom: i >= courses.length };
  });
  const assignments: Record<string, { placementId: string; personKey: string; driverId: string; name: string }[]> = {};
  for (const month of ["2026-08", "2026-09"]) {
    for (let day = 1; day <= (month === "2026-08" ? 31 : 30); day++) {
      const date = `${month}-${String(day).padStart(2, "0")}`;
      lanes.forEach((lane, i) => {
        assignments[`${lane.id}|${date}`] = Array.from({ length: (day + i) % 4 === 0 ? 0 : (day + i) % 3 === 0 ? 1 : 2 }, (_, j) => {
          const driver = drivers[(i * 2 + day + j) % drivers.length];
          return { placementId: `${date}-${i}-${j}`, personKey: driver.id, driverId: driver.id, name: driver.name };
        });
      });
    }
  }
  localStorage.setItem("hakotora_personal_shift_memo_v1:preview-admin", JSON.stringify({ version: 1, lanes,
    laneOrder: lanes.map(lane => lane.id), hiddenLaneIds: [], assignments, extraPeople: [], notes: {},
    widths: { day: 76, lane: 190, detail: 330 } }));
}
export function AdminLayout({ children }: { children: ReactNode }) {
  const [memoRevision, setMemoRevision] = useState(0);
  const [handoffsOpen, setHandoffsOpen] = useState(false);
  const [handoffRevision, setHandoffRevision] = useState(0);
  const reset = () => { resetPreviewShifts(); setHandoffsOpen(false); setHandoffRevision(value => value + 1); };
  return <AdminPreviewLayout pathname="/admin/shifts" onReset={reset}>
    <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-slate-200 pb-2 text-[11px] text-slate-500">
      <span>本番シフト画面のコードを使用 · 架空データ · DB・API・通知への接続なし</span>
      <button type="button" className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-amber-950" onClick={() => { seedHandoffScenario(); setHandoffsOpen(true); }}>車両移動を試す</button>
      <button type="button" className="ml-auto rounded border border-slate-300 bg-white px-2 py-1" onClick={() => { failNext = true; }}>次の保存を失敗させる</button>
      <button type="button" className="rounded border border-slate-300 bg-white px-2 py-1" onClick={() => setPreviewLeaseScenario("empty")}>契約が全員未設定</button>
      <button type="button" className="rounded border border-slate-300 bg-white px-2 py-1" onClick={() => setPreviewLeaseScenario("error")}>契約の取得失敗</button>
      <button type="button" className="rounded border border-slate-300 bg-white px-2 py-1" onClick={() => { firstDriverDaily = true; leaseScenario = "normal"; notify(); }}>佐藤の契約を日額へ変更</button>
      <button type="button" className="rounded border border-slate-300 bg-white px-2 py-1" onClick={reset}>サンプルを初期化</button>
      {[12, 40].map(count => <button key={count} type="button" className="rounded border border-slate-300 bg-white px-2 py-1" onClick={() => { seedPreviewMemo(count); setMemoRevision(value => value + 1); }}>メモ{count}枠のサンプル</button>)}
    </div>
    <Fragment key={memoRevision}>{children}</Fragment>
    <VehicleHandoffsPreview key={handoffRevision} open={handoffsOpen} onClose={() => setHandoffsOpen(false)}/>
  </AdminPreviewLayout>;
}
