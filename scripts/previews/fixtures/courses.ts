// 本番コース管理ページの隔離プレビュー。単価・請求先は架空値だけを使う。
import type { PreviewFixture } from "@/lib/preview/fixtureStore";
import type { CourseRatePreviewData } from "@/lib/components/CourseRateEditor";

type Course = {
  id: string; name: string; color: string; sort_order: number; carrier_id: string;
  summary_title: string | null; daily_lease: number; max_drivers: number;
  uses_cycles: boolean; course_cycles: [];
};
type State = { courses: Course[]; billing: Record<string, CourseRatePreviewData> };
const carrierId = "preview-carrier";
const units: CourseRatePreviewData["units"] = [{ id: "unit-parcel", name: "宅急便", code: "PARCEL", billing_type: "PER_PIECE" }];
const blankBilling = (courseName: string): CourseRatePreviewData => ({
  courseName, carrierId, units, unitRates: [],
  fixed: { fixed_revenue: 0, fixed_profit: 0, fixed_payout: 0 },
  revenueRateMode: "PER_PIECE", payoutRateMode: "PER_PIECE",
});

export const coursesFixture: PreviewFixture<State> = {
  id: "courses", title: "コース管理", pathname: "/admin/courses",
  scenarios: {
    normal: { label: "通常", description: "コース作成と単価設定を操作する" },
    empty: { label: "0件", description: "コースがない状態から作成する" },
    "long-name": { label: "長い名前", description: "長いコース名で表示を確認する" },
  },
  createState: ({ scenario }) => ({
    courses: scenario === "empty" ? [] : [{
      id: "preview-course-1", name: scenario === "long-name" ? "西大阪集配センター・午前午後混合配送コース" : "豊中",
      color: "#fbbf24", sort_order: 0, carrier_id: carrierId,
      summary_title: "豊中", daily_lease: 0, max_drivers: 2, uses_cycles: false, course_cycles: [],
    }],
    billing: {},
  }),
  read: (state, { path, params }) => {
    if (path === "/api/admin/courses") return { courses: state.courses };
    if (path === "/api/admin/users") return { drivers: [] };
    if (path === "/api/admin/invoice-addresses") return { addresses: [] };
    if (path === "/api/admin/carriers") return { carriers: [{ id: carrierId, name: "サンプル配送", code: "SAMPLE" }] };
    if (path === "/api/admin/shift-slots") return { slots: [] };
    if (path === "/api/admin/course-billing") {
      const course = state.courses.find((item) => item.id === params.get("course_id"));
      return state.billing[course?.id ?? ""] ?? blankBilling(course?.name ?? "新規コース");
    }
    return undefined;
  },
  write: (state, { path, method, body }, { role }) => {
    if (role !== "admin") throw new Error("この操作の権限がありません");
    if (path === "/api/admin/courses" && method === "POST") {
      const course: Course = {
        id: `preview-course-${state.courses.length + 1}`, name: String(body.name ?? "新規コース"),
        color: String(body.color ?? "#fbbf24"), sort_order: state.courses.length,
        carrier_id: String(body.carrier_id ?? carrierId), summary_title: body.summary_title == null ? null : String(body.summary_title),
        daily_lease: Number(body.daily_lease ?? 0), max_drivers: Number(body.max_drivers ?? 1),
        uses_cycles: false, course_cycles: [],
      };
      state.courses.push(course);
      return { course };
    }
    if (path === "/api/admin/course-billing" && (method === "PUT" || method === "POST")) {
      const courseId = String(body.courseId ?? body.course_id ?? "");
      const course = state.courses.find((item) => item.id === courseId);
      if (!course) throw new Error("コースが見つかりません");
      state.billing[courseId] = { ...blankBilling(course.name), ...body, courseName: course.name, carrierId: carrierId } as CourseRatePreviewData;
      return { ok: true };
    }
    return undefined;
  },
};
