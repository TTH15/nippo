import { driverSettingsPath, type DriverSettings, type DriverSettingsRow } from "@/lib/drivers/settings";
import type { PreviewFixture } from "@/lib/preview/fixtureStore";
type State = DriverSettings & { amounts: Record<string, number>; fail: boolean; versions: Record<string,number> };
const names = ["佐藤 翔太", "田中 美咲", "鈴木 大輔", "高橋 健太", "伊藤 彩", "渡辺 直樹"];
export const driverSettingsFixture: PreviewFixture<State> = {
  id: "driver-settings", title: "ドライバー設定", pathname: "/admin/driver-settings",
  scenarios: { normal: { label: "通常" }, empty: { label: "ドライバーなし" }, "long-name": { label: "長い名前" }, large: { label: "多数" }, "save-error": { label: "初回の保存に失敗" } },
  createState: ({ role,scenario }) => {
    const vehicles = ["1201","2792","3840","4521"].map((number_numeric,i) => ({ id: "v"+i, number_prefix: "大阪", number_class: "480", number_hiragana: "り", number_numeric, plate_color: "black" }));
    const drivers = Array.from({length: scenario === "empty" ? 0 : scenario === "large" ? 54 : names.length}, (_,i): DriverSettingsRow => ({
      id: "d"+i, name: scenario === "long-name" && !i ? "サンプル・アレクサンダー・太郎" : names[i%6] + (i >= 6 ? " " + i : ""),
      lease: i%3 === 0 ? "MONTHLY" : i%3 === 1 ? "DAILY" : null,
      vehicleIds: i%4 === 2 ? [] : i%4 === 3 ? ["v1","v3"] : ["v"+(i%4)], parking: i%3 !== 0,
    }));
    const admin = role === "admin";
    return { drivers, vehicles, amounts: {}, versions: {}, fail: scenario === "save-error", permissions: { viewLease: role !== "viewer", editLease: admin, viewVehicles: true, editVehicles: admin, editRequirements: admin } };
  },
  read: (state, {path,params}) => {
    if (path === driverSettingsPath) return { drivers: state.drivers, vehicles: state.vehicles, permissions: state.permissions };
    if (path === "/api/admin/driver-lease") {
      const id = params.get("driver_id") ?? "";
      const row = state.drivers.find(item => item.id === id);
      return { lease: row?.lease ? { mode: row.lease, amount: state.amounts[id] ?? 32000 } : null, upcoming: [], revision: String(state.versions[id] ?? 0).padStart(32,"0") };
    }
  },
  write: (state,{path,body},ctx) => {
    if (ctx.role !== "admin") throw new Error("この設定を変更する権限がありません。");
    if (state.fail) { state.fail = false; throw new Error("保存できませんでした。もう一度お試しください。"); }
    const row = state.drivers.find(item => item.id === (body.driverId ?? body.driver_id));
    if (!row) throw new Error("ドライバーが見つかりません。");
    if (path === "/api/admin/driver-lease") {
      row.lease = body.enabled ? body.mode as DriverSettingsRow["lease"] : null;
      state.amounts[row.id] = Number(body.amount);
      state.versions[row.id] = (state.versions[row.id] ?? 0) + 1;
    } else if (path === driverSettingsPath && body.field === "vehicles") row.vehicleIds = [...body.value as string[]];
    else if (path === driverSettingsPath && body.field === "parking") row.parking = body.value === true;
    else return undefined;
    return { ok: true };
  },
};
