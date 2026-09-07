// 日報送信（本番 /submit の SubmitPageClientV2）用の架空データ。「車の置き場所」の確認が目的。
// 送信内容は console.info("preview submit", …) に出す（アプリ内ブラウザから確認する）。
import type { PreviewFixture } from "@/lib/preview/fixtureStore";

const VEHICLES = [
  { id: "veh-1", number_prefix: "大阪", number_class: "480", number_hiragana: "り", number_numeric: "1201", plate_color: "black", manufacturer: "ホンダ", brand: "アクティ", current_mileage: 50000, is_ev: false, last_oil_change_mileage: 48000, oil_change_interval: 15000 },
  { id: "veh-2", number_prefix: "京都", number_class: "480", number_hiragana: "れ", number_numeric: "2752", plate_color: "black", manufacturer: "スズキ", brand: "エブリイ", current_mileage: 0, is_ev: false, last_oil_change_mileage: 0, oil_change_interval: 15000 },
];
const SHIFT = {
  courseId: "course-1", cycleNo: 1, cycleLabel: "1便", courseName: "北ルート", color: "#3b82f6", carrierId: "carrier-1", carrierName: "プレビュー運輸",
  units: [{ id: "unit-1", name: "宅配", code: "TAKUHAI", billingType: "PER_PIECE", fields: [
    { fieldKey: "delivered", label: "完了", inputType: "INT", groupLabel: "個数", required: true },
    { fieldKey: "undelivered", label: "持戻り", inputType: "INT", groupLabel: "個数", required: false },
  ] }],
  existing: null,
};
const PLACES = [
  { id: "place-toyonaka", name: "豊中センター", lat: 34.7855, lng: 135.4709, icon: "warehouse", slots: [
    { id: "slot-a1", label: "A-1", vehicleId: "veh-1" }, { id: "slot-a2", label: "A-2", vehicleId: null }, { id: "slot-a3", label: "A-3", vehicleId: "veh-2" },
  ] },
  { id: "place-kyoto", name: "京都車庫", lat: 35.0116, lng: 135.7681, icon: "warehouse", slots: [] },
  { id: "place-suita", name: "吹田 待機", lat: 34.7645, lng: 135.5158, icon: "parking", slots: [] },
];

type State = { places: typeof PLACES; submissions: unknown[] };

export const submitFixture: PreviewFixture<State> = {
  id: "submit",
  title: "日報送信（車の置き場所）",
  pathname: "/submit",
  scenarios: {
    normal: { label: "通常", description: "車庫3件（豊中は区画あり・veh-1 は A-1 がいつもの）" },
    "no-places": { label: "車庫なし", description: "登録車庫が無い会社。別の場所と状況だけ選べる" },
  },
  createState: ({ scenario }) => ({ places: scenario === "no-places" ? [] : PLACES, submissions: [] }),
  read: (state, { path }) => {
    if (path === "/api/reports/profile") return { identities: [{ id: "identity-1", slot: 1, driverCode: "0123", officeCode: "45", label: "1つ目" }] };
    if (path === "/api/reports/vehicles-unlinked") return { vehicles: [] };
    if (path === "/api/reports/vehicles") return { vehicles: VEHICLES };
    if (path === "/api/reports/parking-places") return { places: state.places };
    if (path === "/api/me/report-form") return { shifts: [SHIFT], shiftVehicleId: "veh-1" };
    if (path === "/api/me/form-notice") return { notice: null };
    if (path === "/api/me/shift-deadline-reminder") return { reminder: null };
    if (path === "/api/me/submit-screen") return { todayReward: 12000, blocks: [{ id: "greeting", type: "greeting", title: "お疲れさまでした", message: "" }, { id: "reward", type: "today_reward", todayReward: 12000 }] };
    if (path.startsWith("/api/")) return {};
    return undefined;
  },
  write: (state, { path, method, body }) => {
    if (path === "/api/reports/v2" && method === "POST") {
      state.submissions.push(body);
      console.info("preview submit", JSON.stringify(body));
      return { ok: true, reportIds: ["report-1"], parkingSaved: (body.parking as { status?: string } | null)?.status === "parked" };
    }
    return undefined;
  },
};
