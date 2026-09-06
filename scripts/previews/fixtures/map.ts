// 地図（本番 /admin/map のページ本体）用の架空データ。位置・拠点・区画・配達エリア・車両移動を持ち、
// 手動配置・移動の登録／完了・拠点の追加を画面内で試せる。座標は近畿圏の架空位置。
import type { PreviewFixture } from "@/lib/preview/fixtureStore";

type Position = {
  lat: number; lng: number; at: string | null; kind: "checkin" | "checkout" | "manual" | "gps";
  source?: "punch" | "manual" | "gps"; placedBy?: string; note?: string | null;
  sessionStatus: "open" | "closed"; driverName: string;
};
type MockVehicle = {
  id: string; number_prefix: string | null; number_class: string | null; number_hiragana: string | null; number_numeric: string | null;
  plate_color: string; manufacturer: string | null; brand: string | null; model_key: string | null; body_color: string | null;
  current_mileage?: number; last_oil_change_mileage?: number; oil_change_interval?: number; is_ev?: boolean; next_shaken_date?: string | null;
  is_unavailable?: boolean; position: Position | null;
};
type Place = { id: string; name: string; lat: number; lng: number; icon: string; shape: "point" | "circle"; radius_m: number | null };
type Slot = { id: string; place_id: string; label: string; geometry: { type: "Polygon"; coordinates: [number, number][][] }; bearing: number; lat: number; lng: number; vehicle_id: string | null };
type Movement = {
  id: string; vehicleId: string; fromPlaceId: string; toPlaceId: string; assigneeDriverId: string | null; dueAt: string;
  status: "needed" | "planned" | "arrived" | "cancelled"; note: string | null; actualPlaceId: string | null; arrivedAt: string | null; version: number;
};

const TOYONAKA = { lat: 34.7855, lng: 135.4709 };
const KYOTO = { lat: 35.0116, lng: 135.7681 };
const SUITA = { lat: 34.7645, lng: 135.5158 };

const places: Place[] = [
  { id: "place-toyonaka", name: "豊中センター", ...TOYONAKA, icon: "warehouse", shape: "circle", radius_m: 150 },
  { id: "place-kyoto", name: "京都車庫", ...KYOTO, icon: "warehouse", shape: "point", radius_m: null },
  { id: "place-suita", name: "吹田 待機", ...SUITA, icon: "pin", shape: "point", radius_m: null },
];
const drivers = [
  { id: "driver-1", name: "佐藤 翔太" },
  { id: "driver-2", name: "高橋 健太" },
  { id: "driver-3", name: "田中 美咲" },
];

function slotPolygon(lat: number, lng: number, bearing: number): Slot["geometry"] {
  const w = 0.000012, l = 0.000024;
  const rad = (bearing * Math.PI) / 180;
  const rot = (dx: number, dy: number): [number, number] => [lng + (dx * Math.cos(rad) - dy * Math.sin(rad)) / Math.cos((lat * Math.PI) / 180), lat + dx * Math.sin(rad) + dy * Math.cos(rad)];
  return { type: "Polygon", coordinates: [[rot(-w, -l), rot(w, -l), rot(w, l), rot(-w, l), rot(-w, -l)]] };
}
const slots: Slot[] = [
  { id: "slot-1", place_id: "place-toyonaka", label: "A-1", geometry: slotPolygon(TOYONAKA.lat + 0.0003, TOYONAKA.lng - 0.0004, 20), bearing: 20, lat: TOYONAKA.lat + 0.0003, lng: TOYONAKA.lng - 0.0004, vehicle_id: "vehicle-1" },
  { id: "slot-2", place_id: "place-toyonaka", label: "A-2", geometry: slotPolygon(TOYONAKA.lat + 0.0003, TOYONAKA.lng - 0.00035, 20), bearing: 20, lat: TOYONAKA.lat + 0.0003, lng: TOYONAKA.lng - 0.00035, vehicle_id: null },
];

const plate = (prefix: string, cls: string, kana: string, num: string) => ({ number_prefix: prefix, number_class: cls, number_hiragana: kana, number_numeric: num, plate_color: "black" });
const at = (hoursAgo: number) => new Date(Date.parse("2026-09-06T09:00:00+09:00") - hoursAgo * 3600000).toISOString();

function seedVehicles(scenario: string): MockVehicle[] {
  const base: MockVehicle[] = [
    { id: "vehicle-1", ...plate("大阪", "480", "り", "1201"), manufacturer: "ホンダ", brand: "アクティバン", model_key: "acty", body_color: "#2563eb", current_mileage: 149030, last_oil_change_mileage: 148692, oil_change_interval: 3000, next_shaken_date: "2026-11-20",
      position: { lat: TOYONAKA.lat + 0.0003, lng: TOYONAKA.lng - 0.0004, at: at(1), kind: "checkin", source: "punch", sessionStatus: "open", driverName: "佐藤 翔太" } },
    { id: "vehicle-2", ...plate("京都", "480", "れ", "2752"), manufacturer: "スズキ", brand: "エブリイ", model_key: "every", body_color: "#ffffff", current_mileage: 86200, last_oil_change_mileage: 84000, oil_change_interval: 3000,
      position: { lat: 34.8012, lng: 135.4462, at: at(0.5), kind: "gps", source: "gps", sessionStatus: "open", driverName: "高橋 健太" } },
    { id: "vehicle-3", ...plate("大阪", "480", "り", "4303"), manufacturer: "ダイハツ", brand: "ハイゼットカーゴ", model_key: "hijet", body_color: "#272b30", current_mileage: 72410, last_oil_change_mileage: 69000, oil_change_interval: 3000, next_shaken_date: "2027-03-05",
      position: { lat: KYOTO.lat, lng: KYOTO.lng, at: at(20), kind: "manual", source: "manual", placedBy: "サンプル管理者", note: "京都車庫へ置いた", sessionStatus: "closed", driverName: "" } },
    { id: "vehicle-4", ...plate("大阪", "480", "わ", "5854"), manufacturer: null, brand: null, model_key: null, body_color: "#c8102e",
      position: { lat: SUITA.lat + 0.001, lng: SUITA.lng + 0.001, at: at(30), kind: "checkout", source: "punch", sessionStatus: "closed", driverName: "" } },
    { id: "vehicle-5", ...plate("京都", "481", "り", "6290"), manufacturer: "スズキ", brand: "エブリイ", model_key: "every", body_color: "#d7d9d8", position: null },
  ];
  if (scenario === "empty") return base.map((v) => ({ ...v, position: null }));
  if (scenario === "large") {
    return Array.from({ length: 40 }, (_, i) => ({
      ...base[i % 4], id: `vehicle-${i + 1}`, number_numeric: String(1000 + i * 37),
      position: { ...base[i % 4].position!, lat: TOYONAKA.lat + ((i % 8) - 4) * 0.0012, lng: TOYONAKA.lng + (Math.floor(i / 8) - 2) * 0.0015, sessionStatus: i % 3 ? "closed" : "open" },
    }));
  }
  return base;
}

type State = { vehicles: MockVehicle[]; places: Place[]; slots: Slot[]; movements: Movement[]; courseAreas: { id: string; name: string; color: string | null; delivery_area: { type: "Polygon"; coordinates: number[][][] } | null; delivery_area_updated_at: string | null }[] };

export const mapFixture: PreviewFixture<State> = {
  id: "map",
  title: "地図",
  pathname: "/admin/map",
  scenarios: {
    normal: { label: "通常", description: "5台（稼働中2・積み込み中1・稼働外・位置なし）、拠点3、区画2、移動手配1" },
    empty: { label: "位置なし", description: "位置が1台も記録されていない" },
    large: { label: "大量", description: "40台が豊中周辺に密集。札の縮退と3Dの負荷を見る" },
  },
  createState: ({ scenario }) => ({
    vehicles: seedVehicles(scenario),
    places: places.map((p) => ({ ...p })),
    slots: slots.map((s) => ({ ...s })),
    movements: scenario === "empty" ? [] : [{
      id: "movement-1", vehicleId: "vehicle-3", fromPlaceId: "place-kyoto", toPlaceId: "place-toyonaka", assigneeDriverId: "driver-2",
      dueAt: "2026-09-07T07:30:00+09:00", status: "planned", note: null, actualPlaceId: null, arrivedAt: null, version: 1,
    }],
    courseAreas: [
      { id: "course-1", name: "豊中", color: "#fbbf24", delivery_area: { type: "Polygon", coordinates: [[[135.455, 34.775], [135.49, 34.775], [135.49, 34.80], [135.455, 34.80], [135.455, 34.775]]] }, delivery_area_updated_at: at(48) },
      { id: "course-2", name: "吹田", color: "#38bdf8", delivery_area: null, delivery_area_updated_at: null },
    ],
  }),
  read: (state, { path, params }) => {
    const placeById = new Map(state.places.map((p) => [p.id, p]));
    const driverById = new Map(drivers.map((d) => [d.id, d]));
    if (path === "/api/admin/map/vehicles") {
      const asOf = params.get("at");
      // 履歴: 指定時刻より後の記録は無かったことにする（前後の記録は固定の架空値）
      const vehicles = asOf ? state.vehicles.map((v) => v.position && v.position.at && v.position.at > asOf ? { ...v, position: null } : v) : state.vehicles;
      return { vehicles, asOf: asOf ?? null, historyNeighbors: asOf ? { previousAt: at(20), nextAt: at(0.5) } : null };
    }
    if (path === "/api/admin/map/places") return { places: state.places };
    if (path === "/api/admin/map/parking-slots") return { slots: state.slots };
    if (path === "/api/admin/map/course-areas") return { courses: state.courseAreas };
    if (path === "/api/admin/map/movements") {
      return {
        movements: state.movements.map((m) => ({
          ...m,
          fromPlace: placeById.get(m.fromPlaceId) ?? null, toPlace: placeById.get(m.toPlaceId) ?? null,
          assignee: m.assigneeDriverId ? driverById.get(m.assigneeDriverId) ?? null : null,
        })),
        places: state.places.map(({ id, name, lat, lng }) => ({ id, name, lat, lng })),
        drivers,
        upcomingUses: [{ id: "use-1", vehicleId: "vehicle-3", shiftDate: "2026-09-07", meetingTime: "08:00", driver: drivers[1], course: { id: "course-1", name: "豊中" }, cycleNo: 0, slot: 1 }],
      };
    }
    return undefined;
  },
  write: (state, { path, method, body }, { driver }) => {
    if (path === "/api/admin/map/positions" && method === "POST") {
      const target = state.vehicles.find((v) => v.id === body.vehicleId);
      if (!target) return undefined;
      target.position = { lat: Number(body.lat), lng: Number(body.lng), at: new Date().toISOString(), kind: "manual", source: "manual", placedBy: driver.name, note: (body.note as string) ?? null, sessionStatus: target.position?.sessionStatus ?? "closed", driverName: target.position?.driverName ?? "" };
      return { ok: true };
    }
    if (path === "/api/admin/map/movements" && method === "POST") {
      const movement: Movement = { id: `movement-${state.movements.length + 1}`, vehicleId: String(body.vehicleId), fromPlaceId: String(body.fromPlaceId), toPlaceId: String(body.toPlaceId), assigneeDriverId: (body.assigneeDriverId as string) ?? null, dueAt: String(body.dueAt), status: body.assigneeDriverId ? "planned" : "needed", note: (body.note as string) ?? null, actualPlaceId: null, arrivedAt: null, version: 1 };
      state.movements.push(movement);
      return { movement };
    }
    if (path === "/api/admin/map/movements" && method === "PATCH") {
      const movement = state.movements.find((m) => m.id === body.movementId || m.id === body.id);
      if (!movement) return undefined;
      if (body.action === "finish" || body.arrivedAt) {
        movement.status = "arrived"; movement.actualPlaceId = movement.toPlaceId; movement.arrivedAt = String(body.arrivedAt ?? new Date().toISOString());
        const target = state.vehicles.find((v) => v.id === movement.vehicleId); const place = state.places.find((p) => p.id === movement.toPlaceId);
        if (target && place) target.position = { lat: place.lat, lng: place.lng, at: movement.arrivedAt, kind: "manual", source: "manual", placedBy: driver.name, note: "車両移動の完了記録", sessionStatus: "closed", driverName: "" };
      } else if (body.action === "cancel" || body.status === "cancelled") {
        movement.status = "cancelled";
      } else {
        if (body.assigneeDriverId !== undefined) { movement.assigneeDriverId = (body.assigneeDriverId as string) ?? null; movement.status = movement.assigneeDriverId ? "planned" : "needed"; }
        if (body.dueAt) movement.dueAt = String(body.dueAt);
        if (body.toPlaceId) movement.toPlaceId = String(body.toPlaceId);
        if (body.note !== undefined) movement.note = (body.note as string) ?? null;
      }
      movement.version += 1;
      return { movement };
    }
    if (path === "/api/admin/map/places" && method === "POST") {
      const place: Place = { id: `place-${state.places.length + 1}`, name: String(body.name ?? "新しい拠点"), lat: Number(body.lat), lng: Number(body.lng), icon: String(body.icon ?? "pin"), shape: body.radiusM ? "circle" : "point", radius_m: body.radiusM ? Number(body.radiusM) : null };
      state.places.push(place);
      return { place };
    }
    const placeMatch = path.match(/^\/api\/admin\/map\/places\/([^/]+)$/);
    if (placeMatch && method === "PUT") {
      const place = state.places.find((p) => p.id === placeMatch[1]); if (!place) return undefined;
      if (typeof body.name === "string") place.name = body.name; if (typeof body.icon === "string") place.icon = body.icon;
      if (body.radiusM !== undefined) { place.radius_m = body.radiusM ? Number(body.radiusM) : null; place.shape = body.radiusM ? "circle" : "point"; }
      return { ok: true };
    }
    if (placeMatch && method === "DELETE") { state.places = state.places.filter((p) => p.id !== placeMatch[1]); return { ok: true }; }
    if (path === "/api/admin/map/parking-slots" && method === "POST") {
      const slot: Slot = { id: `slot-${state.slots.length + 1}`, place_id: String(body.placeId), label: String(body.label ?? ""), geometry: body.geometry as Slot["geometry"], bearing: Number(body.bearing) || 0, lat: Number(body.lat), lng: Number(body.lng), vehicle_id: (body.vehicleId as string) || null };
      state.slots.push(slot);
      return { slot };
    }
    const slotMatch = path.match(/^\/api\/admin\/map\/parking-slots\/([^/]+)$/);
    if (slotMatch && method === "DELETE") { state.slots = state.slots.filter((s) => s.id !== slotMatch[1]); return { ok: true }; }
    const areaMatch = path.match(/^\/api\/admin\/map\/course-areas\/([^/]+)$/);
    if (areaMatch && method === "PUT") {
      const course = state.courseAreas.find((c) => c.id === areaMatch[1]); if (!course) return undefined;
      course.delivery_area = (body.deliveryArea as typeof course.delivery_area) ?? course.delivery_area; course.delivery_area_updated_at = new Date().toISOString();
      return { ok: true };
    }
    if (areaMatch && method === "DELETE") {
      const course = state.courseAreas.find((c) => c.id === areaMatch[1]); if (!course) return undefined;
      course.delivery_area = null; course.delivery_area_updated_at = null;
      return { ok: true };
    }
    return undefined;
  },
};
