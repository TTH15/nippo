// ダッシュボード（本番 /admin のページ本体）用の架空集計。
import type { PreviewFixture } from "@/lib/preview/fixtureStore";

type SalesRow = { iso: string; date: string; yamato: number; amazon: number; other: number; profit: number };

function rows(start: string, end: string, scale: number): SalesRow[] {
  const out: SalesRow[] = [];
  for (let t = Date.parse(`${start}T00:00:00+09:00`), i = 0; t <= Date.parse(`${end}T00:00:00+09:00`); t += 86400000, i += 1) {
    const d = new Date(t + 9 * 3600000);
    const iso = d.toISOString().slice(0, 10);
    const weekday = d.getUTCDay();
    const busy = weekday === 0 || weekday === 6 ? 0.6 : 1;
    const yamato = Math.round((180000 + ((i * 7919) % 60000)) * busy * scale);
    const amazon = Math.round((90000 + ((i * 104729) % 40000)) * busy * scale);
    const other = Math.round((20000 + ((i * 1301) % 15000)) * busy * scale);
    out.push({ iso, date: `${d.getUTCMonth() + 1}/${d.getUTCDate()}`, yamato, amazon, other, profit: Math.round((yamato + amazon + other) * 0.23) });
  }
  return out;
}

type State = { scale: number; badges: { dailyUnread: number; otherUnread: number; oilAlert: number; licenseAlert: number; pendingApproval: number }; activeDrivers: number };

export const dashboardFixture: PreviewFixture<State> = {
  id: "dashboard",
  title: "ダッシュボード",
  pathname: "/admin",
  scenarios: {
    normal: { label: "通常", description: "今月の売上・粗利・14日推移・要対応バッジあり" },
    empty: { label: "0件", description: "売上0・要対応なし・稼働0名（空状態の文言を確認する）" },
    large: { label: "大きな数字", description: "売上が桁上がりした場合の数値の折返し" },
  },
  createState: ({ scenario }) => ({
    scale: scenario === "empty" ? 0 : scenario === "large" ? 40 : 1,
    badges: scenario === "empty"
      ? { dailyUnread: 0, otherUnread: 0, oilAlert: 0, licenseAlert: 0, pendingApproval: 0 }
      : scenario === "large"
        ? { dailyUnread: 128, otherUnread: 34, oilAlert: 19, licenseAlert: 7, pendingApproval: 12 }
        : { dailyUnread: 3, otherUnread: 1, oilAlert: 2, licenseAlert: 1, pendingApproval: 1 },
    activeDrivers: scenario === "empty" ? 0 : scenario === "large" ? 312 : 9,
  }),
  read: (state, { path, params }) => {
    if (path === "/api/admin/badges") return state.badges;
    if (path === "/api/admin/sales") {
      const month = params.get("month");
      if (month) return { data: rows(`${month}-01`, `${month}-28`, state.scale) };
      return { data: rows(params.get("start") ?? "2026-08-24", params.get("end") ?? "2026-09-06", state.scale) };
    }
    if (path === "/api/admin/shifts" && params.get("countDrivers") === "1") return { count: state.activeDrivers };
    return undefined;
  },
};
