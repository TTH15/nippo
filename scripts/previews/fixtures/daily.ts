import type { PreviewFixture } from "@/lib/preview/fixtureStore";
const names = ["紐付け車両", "報告した車両", "原本の確認済み", "OCR未確認", "番号なし", "他社からの貸与"];
const today = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
type State = { empty: boolean };
export const dailyFixture: PreviewFixture<State> = {
  id: "daily", title: "日報の車両番号", pathname: "/admin/daily",
  scenarios: { "vehicle-number": { label: "車両未紐付け", description: "紐付け・報告値・確認済み原本・未確認OCR・未登録・貸与車" }, empty: { label: "提出なし", description: "日報が無い場合" } },
  createState: ({ scenario }) => ({ empty: scenario === "empty" }),
  read(state, { path }) {
    if (path === "/api/admin/badges") return { dailyUnread: 0, otherUnread: 0 };
    if (path === "/api/admin/daily/all") return { groups: [] };
    if (path.startsWith("/api/admin/daily/day-summary-range")) {
      if (state.empty) return { drivers: [], days: [] };
      const date = today();
      const drivers = names.map((name, i) => ({ id: `driver-${i}`, name, display_name: name, status: "active" }));
      return { drivers, days: [{ date, shiftDriverIds: drivers.map(driver => driver.id), reportsByDriver: Object.fromEntries(drivers.map((driver, i) => [driver.id, [{
        id: `report-${i}`, driver_id: driver.id, report_date: date, course_name: "架空コース", carrier: "YAMATO", submitted_at: `${date}T10:00:00+09:00`, approved_at: null, rejected_at: null,
        vehicle_id: [0, 5].includes(i) ? i === 5 ? "borrowed" : "linked" : null, meter_value: 145545,
        vehicle_plate: [0, 5].includes(i) ? { id: i === 5 ? "borrowed" : "linked", number_prefix: "京都", number_class: "480", number_hiragana: "り", number_numeric: i === 5 ? "7890" : "1234" } : null,
        content: i === 1 ? [{ unitId: "number", unitName: "報告", fields: [{ fieldKey: "vehicle_number", label: "車両番号", inputType: "TEXT", groupLabel: null, valueNum: null, valueText: "大阪 480 れ 45-67" }] }] : [],
        vehicle_number_evidence: [2, 3].includes(i) ? { number: i === 2 ? "京都 480 り 56-78" : "京都 480 り 67-89", source: i === 2 ? "confirmed_image" : "ocr" } : null,
      }]])) }] };
    }
    return undefined;
  },
};
