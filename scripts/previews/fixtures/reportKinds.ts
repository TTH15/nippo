// 本番 /admin/report-kinds を再利用。会社内の設定操作を架空データだけで確認する。
import type { PreviewFixture } from "@/lib/preview/fixtureStore";
import type { ReportKind } from "@/server/reportKinds/config";

function defaultReportKinds(): ReportKind[] {
  return ["オイル交換", "修理", "経費報告", "その他"].map((label, i) => ({
    id: `preview-kind-${i}`, key: `preview_kind_${i}`, label, sortOrder: i, isActive: true,
    vehicleMode: "required", capability: i === 0 ? "oil_mileage" : i === 2 ? "expense" : "none",
    fields: i === 0 ? [{ id: "meter", type: "number", label: "走行距離", required: true, role: "odometer" }]
      : i === 2 ? [{ id: "amount", type: "number", label: "金額", required: true, role: "amount" }]
      : [{ id: "description", type: "long_text", label: "内容", required: true }],
    usesVehicle: true, usesLocation: false, usesOdometer: i === 0, usesDescription: i !== 0,
    usesAmount: i === 2, descriptionRequired: false, descriptionLabel: null,
  }));
}

type State = { kinds: ReportKind[]; nextId: number };
export const reportKindsFixture: PreviewFixture<State> = {
  id: "report-kinds", title: "報告種別", pathname: "/admin/report-kinds",
  scenarios: {
    normal: { label: "通常", description: "報告種別の追加・編集・削除" },
    empty: { label: "未設定", description: "種別が未登録" },
    "long-name": { label: "長い表示名", description: "名称と項目の折り返し" },
    large: { label: "多数", description: "40件の設定" },
    missing: { label: "対象なし", description: "表示後に削除された設定の保存を拒否" },
  },
  createState: ({ scenario }) => ({ nextId: 100, kinds: scenario === "empty" ? [] : Array.from({ length: scenario === "large" ? 40 : 4 }, (_, i) => ({
    ...defaultReportKinds()[i % 4], id: `preview-kind-${i}`, key: `preview_kind_${i}`,
    label: scenario === "long-name" ? "配送先への移動中に発生した立替経費と追加作業の報告" : defaultReportKinds()[i % 4].label,
  })) }),
  read: (state, { path }) => path === "/api/admin/report-kinds" ? { kinds: state.kinds } : undefined,
  write(state, { path, method, body }, { role, scenario }) {
    if (!path.startsWith("/api/admin/report-kinds")) return undefined;
    if (role !== "admin") throw new Error("この操作の権限がありません。");
    if (method === "POST") {
      const kind = { ...defaultReportKinds()[3], ...body, id: `preview-kind-${state.nextId++}` } as ReportKind;
      state.kinds.push(kind);
      return { kind };
    }
    const index = state.kinds.findIndex(k => path === `/api/admin/report-kinds/${k.id}`);
    if (index < 0 || scenario === "missing") throw new Error("報告種別が見つかりません。");
    if (method === "DELETE") { state.kinds.splice(index, 1); return { ok: true }; }
    if (method === "PATCH") { state.kinds[index] = { ...state.kinds[index], ...body }; return { kind: state.kinds[index] }; }
  },
};
