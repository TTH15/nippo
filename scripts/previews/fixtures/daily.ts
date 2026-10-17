import type { PreviewFixture } from "@/lib/preview/fixtureStore";
import { createDailyShiftChange, readDailyShiftChange, writeDailyShiftChange } from "./dailyShiftChange";
const names = ["紐付け車両", "報告した車両", "原本の確認済み", "OCR未確認", "番号なし", "他社からの貸与"];
const today = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
type State = { empty: boolean; shiftChange: ReturnType<typeof createDailyShiftChange> | null };
export const dailyFixture: PreviewFixture<State> = {
  id: "daily", title: "日報", pathname: "/admin/daily",
  scenarios: {
    normal: { label: "通常", description: "日報の車両番号" },
    mismatch: { label: "シフトと不一致", description: "シフト外のコースを提出した状態" },
    "legacy-whole": { label: "旧全体日報", description: "C1・C2の予定と旧全体日報1件を照合" },
    "duplicate-report": { label: "重複提出", description: "同じ便の日報が複数ある状態" },
    "cycle-added": { label: "C2を追加", description: "承認済みC1を保持し、追加したC2だけ代理入力" },
    "multi-course": { label: "複数コース・C1/C2", description: "同じ車両とメーターで3件の実績を提出" },
    "different-readings": { label: "別のメーター値", description: "同日の異なる読取値を保持" },
    "different-vehicles": { label: "途中で乗換え", description: "車両ごとにメーターを表示" },
    "shift-changed": { label: "シフト変更後", description: "解除分は履歴から確認" },
    "vehicle-number": { label: "車両未紐付け", description: "紐付け・報告値・確認済み原本・未確認OCR・未登録・貸与車" },
    "long-name": { label: "長い名前", description: "長いドライバー名とコース名" },
    large: { label: "多数のコース", description: "1人の日報に多数のコース" },
    empty: { label: "提出なし", description: "日報が無い場合" },
  },
  createState: ({ scenario }) => ({ empty: scenario === "empty", shiftChange: ["mismatch", "legacy-whole", "duplicate-report", "cycle-added", "shift-changed", "multi-course", "different-readings", "different-vehicles", "long-name", "large"].includes(scenario) ? createDailyShiftChange(scenario) : null }),
  write(state, request) {
    if (state.shiftChange) return writeDailyShiftChange(state.shiftChange, request);
    return undefined;
  },
  read(state, request) {
    if (state.shiftChange) return readDailyShiftChange(state.shiftChange, request);
    const { path } = request;
    if (path === "/api/admin/badges") return { dailyUnread: 0, otherUnread: 0 };
    if (path === "/api/admin/daily/all") return { groups: [] };
    if (path.startsWith("/api/admin/daily/day-summary-range")) {
      if (state.empty) return { drivers: [], days: [] };
      const date = today();
      const drivers = names.map((name, i) => ({ id: `driver-${i}`, name, display_name: name, status: "active" }));
      return { drivers, days: [{ date, shiftDriverIds: drivers.map(driver => driver.id), shiftAssignmentsByDriver: Object.fromEntries(drivers.map(driver => [driver.id, [{ courseId: "fictional-normal", courseName: "架空コース", cycleNo: 0 }]])), reportsByDriver: Object.fromEntries(drivers.map((driver, i) => [driver.id, [{
        id: `report-${i}`, driver_id: driver.id, report_date: date, course_id: "fictional-normal", course_name: "架空コース", carrier: "YAMATO", submitted_at: `${date}T10:00:00+09:00`, approved_at: null, rejected_at: null,
        vehicle_id: [0, 5].includes(i) ? i === 5 ? "borrowed" : "linked" : null, meter_value: 145545,
        vehicle_plate: [0, 5].includes(i) ? { id: i === 5 ? "borrowed" : "linked", number_prefix: "京都", number_class: "480", number_hiragana: "り", number_numeric: i === 5 ? "7890" : "1234" } : null,
        content: i === 1 ? [{ unitId: "number", unitName: "報告", fields: [{ fieldKey: "vehicle_number", label: "車両番号", inputType: "TEXT", groupLabel: null, valueNum: null, valueText: "大阪 480 れ 45-67" }] }] : [],
        vehicle_number_evidence: [2, 3].includes(i) ? { number: i === 2 ? "京都 480 り 56-78" : "京都 480 り 67-89", source: i === 2 ? "confirmed_image" : "ocr" } : null,
      }]])) }] };
    }
    return undefined;
  },
};
