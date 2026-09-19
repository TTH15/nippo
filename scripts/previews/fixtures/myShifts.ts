// 本番のドライバー画面 (user)/shifts を架空データで操作する。
// 新しい「予定の確認」（ShiftPlanConfirmations）の確認・対応不可を試せるようにする。
import type { PreviewFixture } from "@/lib/preview/fixtureStore";

const day = (offset: number) => new Date(Date.now() + 9 * 3600_000 + offset * 86400_000).toISOString().slice(0, 10);

type ConfirmationDay = {
  date: string;
  planVersion: string;
  response: "confirmed" | "unavailable" | null;
  staleResponse: "confirmed" | "unavailable" | null;
  note: string;
  respondedAt: string | null;
};

function createData(scenario: string) {
  const base = (date: string, over: Partial<ConfirmationDay> = {}): ConfirmationDay => ({
    date, planVersion: `v-${date}`, response: null, staleResponse: null, note: "", respondedAt: null, ...over,
  });
  const days: ConfirmationDay[] =
    scenario === "none" ? []
    : scenario === "done" ? [base(day(1), { response: "confirmed" }), base(day(2), { response: "confirmed" })]
    : scenario === "changed" ? [base(day(1), { staleResponse: "confirmed" }), base(day(3))]
    : [base(day(1)), base(day(2), { response: "confirmed" }), base(day(3), { response: "unavailable" }), base(day(5))];
  return { days, shifts: [] as unknown[], failNext: scenario === "save-error" };
}

export type MyShiftsFixtureState = ReturnType<typeof createData>;

export const myShiftsFixture: PreviewFixture<MyShiftsFixtureState> = {
  id: "my-shifts", title: "ドライバーのシフト確認", pathname: "/shifts",
  scenarios: {
    normal: { label: "未確認あり", description: "確認・対応不可・確認済みが混在" },
    none: { label: "予定なし", description: "確認する予定が無い" },
    done: { label: "すべて確認済み", description: "操作が残っていない状態" },
    changed: { label: "予定が変わった", description: "確認後に予定が変わり再確認になる" },
    "save-error": { label: "送信失敗", description: "確認の送信が失敗して再試行できる" },
  },
  createState: ({ scenario }) => createData(scenario),
  read(state, { path, params }) {
    if (path === "/api/me/shift-confirmations") return { days: state.days, unavailable: false };
    if (path === "/api/me/shifts") return { shifts: state.shifts };
    if (path === "/api/shifts/requests") return { requests: [], slots: [] };
    if (path === "/api/shifts/deadlines") return { periods: [] };
    // 月の切り替えでキーが変わっても同じ結果を返す
    if (path.startsWith("/api/me/shifts") && params.get("start")) return { shifts: state.shifts };
    return undefined;
  },
  write(state, { path, body }) {
    if (path !== "/api/me/shift-confirmations") return undefined;
    if (state.failNext) { state.failNext = false; throw new Error("確認を送れませんでした。もう一度お試しください。"); }
    const target = state.days.find((d) => d.date === body.date);
    if (!target) throw new Error("その日の予定がありません");
    if (target.planVersion !== body.planVersion) throw new Error("予定が変わりました。最新の予定を開いて確認してください");
    target.response = body.response as "confirmed" | "unavailable";
    target.staleResponse = null;
    target.respondedAt = new Date().toISOString();
    return { ok: true, planVersion: target.planVersion };
  },
};
