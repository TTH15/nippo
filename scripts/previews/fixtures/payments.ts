// 支払い（月次の報酬と経費）の fixture。
// 固定控除の期間・名前・金額をその場で直せるようにした改修（2026-09-09）を、
// 本番のページ本体で確かめるために用意した。実在の金額・氏名は使わない。
import type { PreviewFixture } from "@/lib/preview/fixtureStore";

type Fixed = { id: string; name: string; amount: number; valid_from: string; valid_to: string | null };
type AdHoc = { id: string; name: string; amount: number };
type Row = {
  driverId: string;
  name: string;
  incomeLog: number;
  yamatoIncome: number;
  amazonIncome: number;
  otherIncome: number;
  fixedDeductions: number;
  adHocDeductions: number;
  leaseDeductions: number;
  net: number;
};

type State = { rows: Row[]; fixed: Record<string, Fixed[]>; adHoc: Record<string, AdHoc[]> };

const D1 = "00000000-0000-4000-8000-000000000101";
const D2 = "00000000-0000-4000-8000-000000000102";

function seed(scenario: string): State {
  // 1人目はリース契約も持っている＝固定「リース代」と二重になっている状態
  const fixed: Record<string, Fixed[]> = {
    [D1]: [
      { id: "fx-1", name: "事務手数料手数料", amount: 4000, valid_from: "2026-03-01", valid_to: null },
      { id: "fx-2", name: "リース代", amount: 35000, valid_from: "2026-07-01", valid_to: null },
    ],
    [D2]: [{ id: "fx-3", name: "事務手数料", amount: 4000, valid_from: "2026-05-01", valid_to: "2026-08-31" }],
  };
  const rows: Row[] = [
    {
      driverId: D1, name: "見本 太郎",
      incomeLog: 145372, yamatoIncome: 145372, amazonIncome: 0, otherIncome: 0,
      fixedDeductions: 39000, adHocDeductions: 0, leaseDeductions: 35000, net: 71372,
    },
    {
      driverId: D2, name: "見本 花子",
      incomeLog: 98000, yamatoIncome: 0, amazonIncome: 98000, otherIncome: 0,
      fixedDeductions: 4000, adHocDeductions: 2000, leaseDeductions: 0, net: 92000,
    },
  ];
  if (scenario === "empty") return { rows: [], fixed: {}, adHoc: {} };
  return { rows, fixed, adHoc: { [D2]: [{ id: "ah-1", name: "備品代", amount: 2000 }] } };
}

const rewardsFor = (state: State, driverId: string, month: string) => {
  const row = state.rows.find((r) => r.driverId === driverId);
  const fixed = state.fixed[driverId] ?? [];
  return {
    month,
    startDate: `${month}-01`,
    endDate: `${month}-30`,
    incomeLog: row?.incomeLog ?? 0,
    variableDeductions: 0,
    fixedDeductions: row?.fixedDeductions ?? 0,
    optionalDeductions: 0,
    leaseDeductions: row?.leaseDeductions ?? 0,
    net: row?.net ?? 0,
    logDetails: [
      { log_date: `${month}-01`, content: "完了個数 143個 持戻個数 9個", amount: 20960 },
      { log_date: `${month}-02`, content: "完了個数 158個 持戻個数 6個", amount: 22865 },
    ],
    dailyIncomeDetails: [],
    fixedDetails: fixed.map((f) => ({ name: f.name, amount: f.amount })),
    optionalDetails: [],
  };
};

export const paymentsFixture: PreviewFixture<State> = {
  id: "payments",
  title: "支払い",
  pathname: "/admin/payments",
  scenarios: {
    normal: { label: "通常", description: "2名。1人目は固定「リース代」とリース契約が二重になっている" },
    empty: { label: "対象なし", description: "その月に支払い対象がいない" },
  },
  createState: ({ scenario }) => seed(scenario),

  read: (state, { path, params }) => {
    if (path === "/api/admin/payments") {
      return { month: params.get("month") ?? "", rows: state.rows };
    }
    if (path === "/api/admin/driver-expenses") {
      return { expenses: state.fixed[params.get("driver_id") ?? ""] ?? [] };
    }
    if (path === "/api/admin/driver-ad-hoc-expenses") {
      return { expenses: state.adHoc[params.get("driver_id") ?? ""] ?? [] };
    }
    if (path === "/api/admin/driver-rewards") {
      return rewardsFor(state, params.get("driver_id") ?? "", params.get("month") ?? "");
    }
    return undefined;
  },

  write: (state, { path, method, body }) => {
    const fixedMatch = path.match(/^\/api\/admin\/driver-expenses\/([^/]+)$/);
    if (fixedMatch) {
      for (const list of Object.values(state.fixed)) {
        const row = list.find((f) => f.id === fixedMatch[1]);
        if (!row) continue;
        if (method === "DELETE") {
          list.splice(list.indexOf(row), 1);
          return { ok: true };
        }
        if (method === "PATCH") {
          if (body.name !== undefined) row.name = String(body.name);
          if (body.amount !== undefined) row.amount = Number(body.amount);
          if (body.valid_from !== undefined) row.valid_from = String(body.valid_from);
          if (body.valid_to !== undefined) row.valid_to = body.valid_to == null ? null : String(body.valid_to);
          return { expense: row };
        }
      }
      return undefined;
    }
    if (path === "/api/admin/driver-expenses" && method === "POST") {
      const driverId = String(body.driver_id);
      const row: Fixed = {
        id: `fx-${Math.random().toString(36).slice(2, 8)}`,
        name: String(body.name),
        amount: Number(body.amount),
        valid_from: String(body.valid_from),
        valid_to: body.valid_to == null ? null : String(body.valid_to),
      };
      (state.fixed[driverId] ??= []).push(row);
      return { expense: row };
    }
    if (path === "/api/admin/driver-ad-hoc-expenses" && method === "POST") {
      const driverId = String(body.driver_id);
      const row: AdHoc = {
        id: `ah-${Math.random().toString(36).slice(2, 8)}`,
        name: String(body.name),
        amount: Number(body.amount),
      };
      (state.adHoc[driverId] ??= []).push(row);
      return { expense: row };
    }
    const adHocMatch = path.match(/^\/api\/admin\/driver-ad-hoc-expenses\/([^/]+)$/);
    if (adHocMatch && method === "DELETE") {
      for (const list of Object.values(state.adHoc)) {
        const row = list.find((a) => a.id === adHocMatch[1]);
        if (row) {
          list.splice(list.indexOf(row), 1);
          return { ok: true };
        }
      }
    }
    return undefined;
  },
};
