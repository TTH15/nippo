import type { PreviewFixture } from "@/lib/preview/fixtureStore";
import type { SpotJob } from "@/app/(admin)/admin/(ops)/spot-jobs/types";
import { currentMonthJST } from "@/lib/date";

type State = { jobs: SpotJob[] };

export const spotJobsFixture: PreviewFixture<State> = {
  id: "spot-jobs", title: "単発案件", pathname: "/admin/spot-jobs",
  scenarios: {
    normal: { label: "通常", description: "架空の案件と金額" },
    "no-pricing": { label: "金額権限なし", description: "配車担当の表示" },
    "sales-only": { label: "売上のみ", description: "売上を個別追加した配車担当" },
  },
  createState: ({ scenario, driver }) => {
    if (scenario === "no-pricing" || scenario === "sales-only") {
      driver.capabilities = driver.capabilities.filter(c => c !== "can_view_sales" && c !== "can_view_profit");
      if (scenario === "sales-only") driver.capabilities.push("can_view_sales");
    }
    return { jobs: [{ id: "job-1", updatedAt: "2026-11-16T10:00:00Z", title: "配送応援", jobDate: `${currentMonthJST()}-15`, meetingPlace: "サンプルセンター",
      meetingTime: "09:00", endTime: "17:00", clientName: "サンプル運輸", billingAmount: 30000,
      note: null, status: "planned", members: [{ id: "member-1", driverId: "driver-1", displayName: null, payAmount: 18000 }] }] };
  },
  read: (state, { path, params }, { driver }) => {
    if (path !== "/api/admin/spot-jobs") return undefined;
    const sales = driver.capabilities.includes("can_view_sales");
    const profit = driver.capabilities.includes("can_view_profit");
    return { jobs: state.jobs.filter(job => !params.get("month") || job.jobDate.startsWith(params.get("month")!)).map(job => ({
      ...job, billingAmount: sales ? job.billingAmount : null,
      members: job.members.map(member => ({ ...member, payAmount: sales && profit ? member.payAmount : null })),
    })), drivers: [{ id: "driver-1", name: "サンプル担当", isGuest: false }] };
  },
  write: (state, { path, method, body }, { driver }) => {
    if (!driver.capabilities.includes("can_manage_shifts")) throw new Error("権限がありません");
    if (path === "/api/admin/spot-jobs" && method === "POST") {
      const job = { ...body, id: `job-${state.jobs.length + 1}`, members: (body.members as SpotJob["members"]) ?? [] } as SpotJob;
      state.jobs.push(job);
      return { job };
    }
    const id = path.match(/^\/api\/admin\/spot-jobs\/([^/]+)$/)?.[1];
    const index = state.jobs.findIndex(job => job.id === id);
    if (index < 0) return undefined;
    if (method === "DELETE") { state.jobs.splice(index, 1); return { ok: true }; }
    if (method === "PATCH") {
      const old = state.jobs[index];
      const next = { ...old, ...body, updatedAt: new Date().toISOString(), members: (body.members as SpotJob["members"]).map(member => ({ ...old.members.find(m => m.id === member.id), ...member })) } as SpotJob;
      state.jobs[index] = next;
      const sales = driver.capabilities.includes("can_view_sales"), profit = driver.capabilities.includes("can_view_profit");
      return { job: { ...next, billingAmount: sales ? next.billingAmount : null, members: next.members.map(m => ({ ...m, payAmount: sales && profit ? m.payAmount : null })) } };
    }
    return undefined;
  },
};
