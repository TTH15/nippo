import type { PreviewFixture } from "@/lib/preview/fixtureStore";
export const salesFixture: PreviewFixture<Record<string, never>> = {
  id: "sales", title: "売上・利益", pathname: "/admin/sales",
  scenarios: { normal: { label: "売上と利益" }, "sales-only": { label: "売上のみ" }, "profit-only": { label: "利益のみ" }, empty: { label: "実績なし" } },
  createState: ({ driver, scenario }) => {
    if (scenario === "sales-only") driver.capabilities = driver.capabilities.filter(c => c !== "can_view_profit");
    if (scenario === "profit-only") driver.capabilities = driver.capabilities.filter(c => c !== "can_view_sales");
    return {};
  },
  read: (_state, { path, params }, { driver, scenario }) => {
    const sales = driver.capabilities.includes("can_view_sales"), profit = driver.capabilities.includes("can_view_profit");
    if (path === "/api/admin/sales") {
      if (!sales && !profit) throw new Error("権限がありません");
      const start = params.get("start") ?? params.get("startDate") ?? "2026-11-01";
      const rows = scenario === "empty" ? [] : Array.from({ length: 15 }, (_, i) => ({ iso: `2026-11-${String(i + 1).padStart(2, "0")}`, date: `11/${i + 1}`,
        ...(sales ? { yamato: 50000 + i * 1000, amazon: 30000, other: 0, cr_sample: 80000 + i * 1000 } : {}),
        ...(profit ? { yamato_profit: 10000, amazon_profit: 7000, profit: 17000 + i * 200, crp_sample: 17000 + i * 200 } : {}), reportCount: 2, pendingCount: 0, logCount: 0 }));
      return { startDate: start, endDate: params.get("end") ?? params.get("endDate") ?? "2026-11-30", basis: "report", data: rows, carriers: [{ id: "sample", key: "cr_sample", profitKey: "crp_sample", name: "サンプル運輸" }] };
    }
    if (path === "/api/admin/sales/log/types") return { types: [] };
    if (path === "/api/admin/sales/log") return { entries: [] };
    if (path === "/api/admin/sales/reports") return { drivers: [], reports: [], midnights: [], summaryCourses: [], courseShifts: [] };
    if (path === "/api/admin/badges") return { dailyUnread: 0, otherUnread: 0 };
    return undefined;
  },
};
