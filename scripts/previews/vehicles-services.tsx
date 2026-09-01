import {
  useCallback,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCar } from "@fortawesome/free-solid-svg-icons";
import { AdminPreviewLayout } from "../../apps/web/src/app/preview/driver-leases/AdminPreviewLayout";

type MockVehicle = {
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

const drivers = [
  { id: "driver-1", name: "佐藤 翔太" },
  { id: "driver-2", name: "高橋 健太" },
  { id: "driver-3", name: "田中 美咲" },
];

const seedVehicles: MockVehicle[] = [
  {
    id: "ffffffff-ffff-4fff-8fff-000000000001",
    created_at: "2026-07-03T09:00:00+09:00",
    manufacturer: "ダイハツ", brand: "ハイゼットカーゴ", model_code: "S700V", body_color: "#d7d9d8",
    is_disposed: false, is_unavailable: false, unavailable_reason: null, is_ev: false,
    number_prefix: "大阪", number_class: "480", number_hiragana: "り", number_numeric: "1201", plate_color: "black",
    current_mileage: 149030, last_oil_change_mileage: 148692, oil_change_interval: 3000,
    purchase_cost: 240000, purchase_cost_items: null, lease_cost: 35000, monthly_insurance: 0,
    recovery_start_month: null, recovery_carryover: 0, image_url: null, image_focus_x: 50, image_focus_y: 50,
    next_shaken_date: "2026-11-20", jibaiseki_renewal_month: "2026-11",
    vehicle_drivers: [{ driver_id: drivers[0].id, drivers: drivers[0] }], driver_link_ids: [drivers[0].id],
  },
  {
    // ID は次の車両より大きいが、登録日時が古いので先に表示される確認用データ。
    id: "ffffffff-ffff-4fff-8fff-000000000002",
    created_at: "2026-07-08T09:00:00+09:00",
    manufacturer: "スズキ", brand: "エブリイ", model_code: "DA17V", body_color: "#ffffff",
    is_disposed: false, is_unavailable: false, unavailable_reason: null, is_ev: false,
    number_prefix: "京都", number_class: "481", number_hiragana: "り", number_numeric: "6290", plate_color: "black",
    current_mileage: 140000, last_oil_change_mileage: 140000, oil_change_interval: 3000,
    purchase_cost: 0, purchase_cost_items: null, lease_cost: 35000, monthly_insurance: 0,
    recovery_start_month: null, recovery_carryover: 0, image_url: null, image_focus_x: 50, image_focus_y: 50,
    next_shaken_date: null, jibaiseki_renewal_month: null,
    vehicle_drivers: [{ driver_id: drivers[1].id, drivers: drivers[1] }], driver_link_ids: [drivers[1].id],
  },
  {
    id: "00000000-0000-4000-8000-000000000003",
    created_at: "2026-07-12T09:00:00+09:00",
    manufacturer: "スズキ", brand: "エブリイ", model_code: "DA17V", body_color: "#272b30",
    is_disposed: false, is_unavailable: false, unavailable_reason: null, is_ev: false,
    number_prefix: "京都", number_class: "480", number_hiragana: "れ", number_numeric: "2752", plate_color: "black",
    current_mileage: 86200, last_oil_change_mileage: 84000, oil_change_interval: 3000,
    purchase_cost: 180000, purchase_cost_items: null, lease_cost: 35000, monthly_insurance: 0,
    recovery_start_month: null, recovery_carryover: 0, image_url: null, image_focus_x: 50, image_focus_y: 50,
    next_shaken_date: null, jibaiseki_renewal_month: null,
    vehicle_drivers: [{ driver_id: drivers[2].id, drivers: drivers[2] }], driver_link_ids: [drivers[2].id],
  },
  {
    id: "00000000-0000-4000-8000-000000000004",
    created_at: "2026-07-05T09:00:00+09:00",
    manufacturer: "ホンダ", brand: "N-VAN", model_code: "JJ1", body_color: "#ffffff",
    is_disposed: false, is_unavailable: true, unavailable_reason: "修理中", is_ev: false,
    number_prefix: "大阪", number_class: "480", number_hiragana: "り", number_numeric: "4810", plate_color: "black",
    current_mileage: 72000, last_oil_change_mileage: 70000, oil_change_interval: 3000,
    purchase_cost: 0, purchase_cost_items: null, lease_cost: 35000, monthly_insurance: 0,
    recovery_start_month: null, recovery_carryover: 0, image_url: null, image_focus_x: 50, image_focus_y: 50,
    next_shaken_date: null, jibaiseki_renewal_month: null, vehicle_drivers: [], driver_link_ids: [],
  },
];

let vehicles = seedVehicles.map((vehicle) => ({ ...vehicle }));
let revision = 0;
let failNextSave = false;
const subscribers = new Set<() => void>();

function notify() {
  revision += 1;
  subscribers.forEach((subscriber) => subscriber());
}

function resetPreview() {
  vehicles = seedVehicles.map((vehicle) => ({ ...vehicle }));
  failNextSave = false;
  notify();
}

function listPage() {
  return { vehicles, canViewCost: true, availabilitySupported: true, hasMore: false };
}

export default function useSWRInfinite<T>() {
  useSyncExternalStore(
    useCallback((subscriber) => { subscribers.add(subscriber); return () => subscribers.delete(subscriber); }, []),
    () => revision,
  );
  return {
    data: [listPage()] as T[], error: undefined, isLoading: false,
    setSize: async () => 1,
    mutate: async () => { notify(); return [listPage()] as T[]; },
  };
}

function dataFor(key: string) {
  if (key === "/api/admin/org/vehicle-colors") return { colors: ["#ffffff", "#272b30", "#d7d9d8"] };
  if (key === "/api/admin/users?all=1") return { drivers };
  if (key === "/api/admin/vehicles/recovery") {
    return { canViewCost: true, recovery: Object.fromEntries(vehicles.map((vehicle) => [vehicle.id, { recovered: 0, remaining: vehicle.purchase_cost }])) };
  }
  return undefined;
}

export function useApi<T>(key: string | null) {
  const currentRevision = useSyncExternalStore(
    useCallback((subscriber) => { subscribers.add(subscriber); return () => subscribers.delete(subscriber); }, []),
    () => revision,
  );
  const data = useMemo(() => key ? dataFor(key) as T : undefined, [key, currentRevision]);
  const refresh = useCallback(async () => key ? dataFor(key) as T : undefined, [key]);
  return { data, error: undefined, isLoading: false, isInitialLoading: false, refresh, mutate: refresh };
}

export async function apiFetch<T>(key: string, init?: RequestInit): Promise<T> {
  const method = init?.method ?? "GET";
  if (method === "GET") {
    if (key.includes("/meter-logs")) return { logs: [] } as T;
    const data = dataFor(key);
    if (data !== undefined) return data as T;
    throw new Error("この操作はプレビュー対象外です。");
  }

  if (failNextSave && (method === "POST" || method === "PUT")) {
    failNextSave = false;
    throw new Error("保存・取得に失敗しました。入力を残したまま再試行してください。");
  }

  const body = JSON.parse(String(init?.body ?? "{}"));
  if (key === "/api/admin/vehicles" && method === "POST") {
    const driverIds = Array.isArray(body.driverIds) ? body.driverIds : [];
    const created: MockVehicle = {
      id: `00000000-0000-4000-8000-${String(vehicles.length + 10).padStart(12, "0")}`,
      created_at: new Date(Date.parse("2026-09-01T09:00:00+09:00") + vehicles.length * 1000).toISOString(),
      manufacturer: body.manufacturer, brand: body.brand, model_code: body.modelCode, body_color: body.bodyColor,
      is_disposed: !!body.isDisposed, is_unavailable: !!body.isUnavailable,
      unavailable_reason: body.unavailableReason, is_ev: !!body.isEv,
      number_prefix: body.numberPrefix, number_class: body.numberClass, number_hiragana: body.numberHiragana,
      number_numeric: body.numberNumeric, plate_color: body.plateColor ?? "black",
      current_mileage: body.currentMileage ?? 0, last_oil_change_mileage: body.lastOilChangeMileage ?? 0,
      oil_change_interval: body.oilChangeInterval ?? 3000, purchase_cost: body.purchaseCost ?? 0,
      purchase_cost_items: null, lease_cost: body.leaseCost ?? 35000, monthly_insurance: body.monthlyInsurance ?? 0,
      recovery_start_month: null, recovery_carryover: body.recoveryCarryover ?? 0,
      image_url: null, image_focus_x: 50, image_focus_y: 50,
      next_shaken_date: body.nextShakenDate, jibaiseki_renewal_month: body.jibaisekiRenewalMonth,
      vehicle_drivers: drivers.filter((driver) => driverIds.includes(driver.id)).map((driver) => ({ driver_id: driver.id, drivers: driver })),
      driver_link_ids: driverIds,
    };
    vehicles = [...vehicles, created];
    notify();
    return { vehicle: created } as T;
  }

  const vehicleMatch = key.match(/^\/api\/admin\/vehicles\/([^/?]+)$/);
  if (vehicleMatch && method === "PUT") {
    vehicles = vehicles.map((vehicle) => vehicle.id === vehicleMatch[1] ? { ...vehicle, manufacturer: body.manufacturer, brand: body.brand } : vehicle);
    notify();
    return { ok: true } as T;
  }
  if (vehicleMatch && method === "DELETE") {
    vehicles = vehicles.filter((vehicle) => vehicle.id !== vehicleMatch[1]);
    notify();
    return { ok: true } as T;
  }
  if (key === "/api/admin/org/vehicle-colors") return { ok: true } as T;
  throw new Error("この操作はプレビュー対象外です。");
}

export const swrFetcher = async () => listPage();
export const getStoredDriver = () => ({ id: "preview-admin", name: "サンプル管理者" });
export const hasCapability = () => true;

export function VehicleModelPreview({ className }: { className?: string }) {
  return (
    <div className={`${className ?? ""} flex items-center justify-center text-slate-300`}>
      <FontAwesomeIcon icon={faCar} className="h-12 w-12" />
    </div>
  );
}

export function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <AdminPreviewLayout pathname="/admin/vehicles" onReset={resetPreview}>
      <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-slate-200 pb-2 text-[11px] text-slate-500">
        <span>本番車両画面のコードを使用 · 架空データ · DB・APIへの接続なし</span>
        <button
          type="button"
          className="ml-auto rounded border border-slate-300 bg-white px-2 py-1"
          onClick={() => { failNextSave = true; }}
        >
          次の保存を失敗させる
        </button>
        <button type="button" className="rounded border border-slate-300 bg-white px-2 py-1" onClick={resetPreview}>
          サンプルを初期化
        </button>
      </div>
      {children}
    </AdminPreviewLayout>
  );
}
