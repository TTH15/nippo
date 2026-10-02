import { meFixture } from "./me";
import type { PreviewFixture } from "@/lib/preview/fixtureStore";
const vehicles = [1, 2].map(i => ({ id: `preview-vehicle-${i}`, number_prefix: "大阪", number_class: "480", number_hiragana: "り", number_numeric: `120${i}`, plate_color: "black", manufacturer: "スズキ", brand: "エブリイ" }));
export const reportFixture: PreviewFixture<ReturnType<typeof meFixture.createState>> = {
  ...meFixture, id: "driver-report", title: "ドライバーのオイル交換報告", pathname: "/report",
  scenarios: {
    normal: { label: "紐付けなし", description: "他の車両だけで選択・送信" },
    linked: { label: "紐付けあり", description: "紐付け車から選択" },
    empty: { label: "車両なし", description: "両一覧とも空" },
    "vehicle-error": { label: "車両取得失敗", description: "車両だけ取得失敗" },
  },
  read: (state, request, context) => {
    const { path } = request;
    if (path === "/api/me/report-kinds") return { kinds: [{ key: "oil_change", label: "オイル交換", vehicleMode: "required", fields: [{ id: "meter", type: "number", label: "走行距離", required: true, role: "odometer" }] }] };
    if (path.startsWith("/api/reports/vehicles")) {
      if (context.scenario === "vehicle-error") throw new Error("車両取得失敗");
      return { vehicles: context.scenario === "empty" ? [] : path.endsWith("-unlinked") ? (context.scenario === "linked" ? vehicles.slice(1) : vehicles) : (context.scenario === "linked" ? vehicles.slice(0, 1) : []) };
    }
    return meFixture.read(state, request, context);
  },
  write: (state, request, context) => request.path === "/api/reports/oil-change" ? { ok: true } : meFixture.write?.(state, request, context),
};
