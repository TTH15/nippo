// 車両一覧（本番 /admin/vehicles のページ本体）用の架空データ。認証・DB・APIには接続しない。
import type { PreviewFixture } from "@/lib/preview/fixtureStore";

export type MockVehicle = {
  id: string;
  created_at: string;
  manufacturer: string | null;
  brand: string | null;
  model_code: string | null;
  body_color: string | null;
  is_disposed: boolean;
  is_unavailable: boolean;
  unavailable_reason: string | null;
  is_ev: boolean;
  number_prefix: string | null;
  number_class: string | null;
  number_hiragana: string | null;
  number_numeric: string | null;
  plate_color: string;
  current_mileage: number;
  last_oil_change_mileage: number;
  oil_change_interval: number;
  purchase_cost: number;
  purchase_cost_items: null;
  lease_cost: number;
  monthly_insurance: number;
  recovery_start_month: null;
  recovery_carryover: number;
  image_url: null;
  image_focus_x: number;
  image_focus_y: number;
  next_shaken_date: string | null;
  jibaiseki_renewal_month: string | null;
  vehicle_drivers: Array<{ driver_id: string; drivers: { id: string; name: string } }>;
  driver_link_ids: string[];
};

export const previewDrivers = [
  { id: "driver-1", name: "佐藤 翔太" },
  { id: "driver-2", name: "高橋 健太" },
  { id: "driver-3", name: "田中 美咲" },
];

const base = {
  is_disposed: false, is_unavailable: false, unavailable_reason: null, is_ev: false, plate_color: "black",
  purchase_cost_items: null, monthly_insurance: 0, recovery_start_month: null, recovery_carryover: 0,
  image_url: null, image_focus_x: 50, image_focus_y: 50, next_shaken_date: null, jibaiseki_renewal_month: null,
  oil_change_interval: 3000, lease_cost: 35000,
} as const;

function linked(driver: (typeof previewDrivers)[number] | undefined) {
  return driver
    ? { vehicle_drivers: [{ driver_id: driver.id, drivers: driver }], driver_link_ids: [driver.id] }
    : { vehicle_drivers: [], driver_link_ids: [] };
}

export const seedVehicles: MockVehicle[] = [
  {
    ...base, id: "ffffffff-ffff-4fff-8fff-000000000001", created_at: "2026-07-03T09:00:00+09:00",
    manufacturer: "ダイハツ", brand: "ハイゼットカーゴ", model_code: "S700V", body_color: "#d7d9d8",
    number_prefix: "大阪", number_class: "480", number_hiragana: "り", number_numeric: "1201",
    current_mileage: 149030, last_oil_change_mileage: 148692, purchase_cost: 240000,
    next_shaken_date: "2026-11-20", jibaiseki_renewal_month: "2026-11", ...linked(previewDrivers[0]),
  },
  {
    // ID は次の車両より大きいが、登録日時が古いので先に表示される確認用データ。
    ...base, id: "ffffffff-ffff-4fff-8fff-000000000002", created_at: "2026-07-08T09:00:00+09:00",
    manufacturer: "スズキ", brand: "エブリイ", model_code: "DA17V", body_color: "#ffffff",
    number_prefix: "京都", number_class: "481", number_hiragana: "り", number_numeric: "6290",
    current_mileage: 140000, last_oil_change_mileage: 140000, purchase_cost: 0, ...linked(previewDrivers[1]),
  },
  {
    ...base, id: "00000000-0000-4000-8000-000000000003", created_at: "2026-07-12T09:00:00+09:00",
    manufacturer: "スズキ", brand: "エブリイ", model_code: "DA17V", body_color: "#272b30",
    number_prefix: "京都", number_class: "480", number_hiragana: "れ", number_numeric: "2752",
    current_mileage: 86200, last_oil_change_mileage: 84000, purchase_cost: 180000, ...linked(previewDrivers[2]),
  },
  {
    ...base, id: "00000000-0000-4000-8000-000000000004", created_at: "2026-07-05T09:00:00+09:00",
    manufacturer: "ホンダ", brand: "N-VAN", model_code: "JJ1", body_color: "#ffffff",
    is_unavailable: true, unavailable_reason: "修理中",
    number_prefix: "大阪", number_class: "480", number_hiragana: "り", number_numeric: "4810",
    current_mileage: 72000, last_oil_change_mileage: 70000, purchase_cost: 0, ...linked(undefined),
  },
];

const longNameVehicles: MockVehicle[] = [
  {
    ...seedVehicles[0], id: "00000000-0000-4000-8000-00000000long",
    manufacturer: "メルセデス・ベンツ・ジャパン合同会社", brand: "スプリンター ロングホイールベース ハイルーフ 特装仕様",
    model_code: "W907-LWB-HR-2026-SPECIAL", unavailable_reason: null,
  },
  {
    ...seedVehicles[3], id: "00000000-0000-4000-8000-0000000long2",
    is_unavailable: true,
    unavailable_reason: "事故修理のため長期入庫中。復帰予定は未定で、代車の手配を検討している（板金塗装と足回り交換）",
  },
  seedVehicles[1],
];

function manyVehicles(count: number): MockVehicle[] {
  const models = [
    ["ダイハツ", "ハイゼットカーゴ", "S700V"], ["スズキ", "エブリイ", "DA17V"], ["ホンダ", "N-VAN", "JJ1"], ["日産", "クリッパー", "DR17V"],
  ];
  const colors = ["#ffffff", "#d7d9d8", "#272b30", "#c8102e"];
  return Array.from({ length: count }, (_, i) => {
    const [manufacturer, brand, model_code] = models[i % models.length];
    return {
      ...base, id: `00000000-0000-4000-8000-${String(1000 + i).padStart(12, "0")}`,
      created_at: new Date(Date.parse("2025-01-10T09:00:00+09:00") + i * 86400000 * 9).toISOString(),
      manufacturer, brand, model_code, body_color: colors[i % colors.length],
      is_unavailable: i % 11 === 5, unavailable_reason: i % 11 === 5 ? "車検中" : null, is_ev: i % 13 === 7,
      number_prefix: i % 2 ? "京都" : "大阪", number_class: "480", number_hiragana: "りれろわ"[i % 4], number_numeric: String(1000 + ((i * 617) % 9000)),
      current_mileage: 20000 + i * 3100, last_oil_change_mileage: 18000 + i * 3100, purchase_cost: i % 3 ? 0 : 150000,
      ...linked(previewDrivers[i % 4 === 3 ? 99 : i % 3]),
    };
  });
}

type State = { vehicles: MockVehicle[]; colors: string[] };

const PAGE_SIZE = 20;

export const vehiclesFixture: PreviewFixture<State> = {
  id: "vehicles",
  title: "車両",
  pathname: "/admin/vehicles",
  scenarios: {
    normal: { label: "通常", description: "4台。使用不可・未紐付け・オイル交換間近を含む" },
    empty: { label: "0件", description: "車両が1台も登録されていない" },
    "long-name": { label: "長い名前", description: "長いメーカー名・車種名・使用不可理由での折返し" },
    large: { label: "大量", description: "45台。20台ずつの追加読み込み" },
  },
  createState: ({ scenario }) => ({
    vehicles: (scenario === "empty" ? [] : scenario === "long-name" ? longNameVehicles : scenario === "large" ? manyVehicles(45) : seedVehicles).map((v) => ({ ...v })),
    colors: ["#ffffff", "#272b30", "#d7d9d8"],
  }),
  read: (state, { path, params }, { driver }) => {
    const canViewCost = driver.capabilities.includes("can_view_vehicle_cost");
    if (path === "/api/admin/vehicles") {
      const cursor = Number(params.get("cursor") ?? "0") || 0;
      const limit = Number(params.get("limit") ?? String(PAGE_SIZE)) || PAGE_SIZE;
      const page = state.vehicles.slice(cursor, cursor + limit);
      const hasMore = cursor + limit < state.vehicles.length;
      return { vehicles: page, canViewCost, availabilitySupported: true, hasMore, nextCursor: hasMore ? String(cursor + limit) : undefined };
    }
    if (path === "/api/admin/org/vehicle-colors") return { colors: state.colors };
    if (path === "/api/admin/users" && params.get("all") === "1") return { drivers: previewDrivers };
    if (path === "/api/admin/vehicles/recovery") {
      return { canViewCost, recovery: Object.fromEntries(state.vehicles.map((v) => [v.id, { recovered: 0, remaining: v.purchase_cost }])) };
    }
    if (/^\/api\/admin\/vehicles\/[^/]+\/meter-logs$/.test(path)) return { logs: [] };
    return undefined;
  },
  write: (state, { path, method, body }) => {
    if (path === "/api/admin/vehicles" && method === "POST") {
      const driverIds = Array.isArray(body.driverIds) ? (body.driverIds as string[]) : [];
      const created: MockVehicle = {
        ...base,
        id: `00000000-0000-4000-8000-${String(state.vehicles.length + 10).padStart(12, "0")}`,
        created_at: new Date(Date.parse("2026-09-01T09:00:00+09:00") + state.vehicles.length * 1000).toISOString(),
        manufacturer: (body.manufacturer as string) ?? null, brand: (body.brand as string) ?? null,
        model_code: (body.modelCode as string) ?? null, body_color: (body.bodyColor as string) ?? null,
        is_disposed: !!body.isDisposed, is_unavailable: !!body.isUnavailable,
        unavailable_reason: (body.unavailableReason as string) ?? null, is_ev: !!body.isEv,
        number_prefix: (body.numberPrefix as string) ?? null, number_class: (body.numberClass as string) ?? null,
        number_hiragana: (body.numberHiragana as string) ?? null, number_numeric: (body.numberNumeric as string) ?? null,
        plate_color: (body.plateColor as string) ?? "black",
        current_mileage: Number(body.currentMileage) || 0, last_oil_change_mileage: Number(body.lastOilChangeMileage) || 0,
        oil_change_interval: Number(body.oilChangeInterval) || 3000, purchase_cost: Number(body.purchaseCost) || 0,
        lease_cost: Number(body.leaseCost) || 35000, monthly_insurance: Number(body.monthlyInsurance) || 0,
        recovery_carryover: Number(body.recoveryCarryover) || 0,
        next_shaken_date: (body.nextShakenDate as string) ?? null, jibaiseki_renewal_month: (body.jibaisekiRenewalMonth as string) ?? null,
        vehicle_drivers: previewDrivers.filter((d) => driverIds.includes(d.id)).map((d) => ({ driver_id: d.id, drivers: d })),
        driver_link_ids: driverIds,
      };
      state.vehicles.push(created);
      return { vehicle: created };
    }
    const match = path.match(/^\/api\/admin\/vehicles\/([^/]+)$/);
    if (match && method === "PUT") {
      const target = state.vehicles.find((v) => v.id === match[1]);
      if (!target) return undefined;
      if (typeof body.manufacturer === "string") target.manufacturer = body.manufacturer;
      if (typeof body.brand === "string") target.brand = body.brand;
      if (typeof body.isUnavailable === "boolean") target.is_unavailable = body.isUnavailable;
      if ("unavailableReason" in body) target.unavailable_reason = (body.unavailableReason as string) ?? null;
      if (typeof body.currentMileage === "number") target.current_mileage = body.currentMileage;
      return { ok: true };
    }
    if (match && method === "DELETE") {
      state.vehicles = state.vehicles.filter((v) => v.id !== match[1]);
      return { ok: true };
    }
    if (path === "/api/admin/org/vehicle-colors") {
      if (Array.isArray(body.colors)) state.colors = body.colors as string[];
      return { ok: true };
    }
    return undefined;
  },
};
