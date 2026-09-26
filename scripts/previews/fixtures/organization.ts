import type { PreviewFixture } from "@/lib/preview/fixtureStore";
import type { PhotoCaptureTask } from "@repo/core/logic/photoCapturePolicy";

type State = { tasks: PhotoCaptureTask[]; version: number; failNext: boolean };
const settings = { name: "プレビュー運送株式会社", invoice_postal_code: null, invoice_address: null, invoice_tel: null,
  invoice_registration_no: null, invoice_bank_name: null, invoice_bank_no: null, invoice_bank_holder: null, stampUrl: null };

export const organizationFixture: PreviewFixture<State> = {
  id: "organization", title: "会社設定・撮影項目", pathname: "/admin/organization",
  scenarios: {
    normal: { label: "通常", description: "追加撮影項目あり" },
    empty: { label: "追加なし", description: "固定の撮影だけ" },
    "save-error": { label: "保存失敗", description: "最初の保存に失敗" },
    "long-name": { label: "長い名前", description: "項目名の折り返し" },
  },
  createState: ({ scenario }) => ({
    tasks: scenario === "empty" ? [] : [
      { id: "oil-sticker", label: scenario === "long-name" ? "オイル交換時期を確認するためのエンジンルーム内の交換シール" : "オイル交換シール", stage: "parking", required: true },
      { id: "key-location", label: "鍵を置いた場所", stage: "parking", required: false },
      { id: "fuel-cap", label: "給油口のキャップ", stage: "end", required: true },
    ], version: 1, failNext: scenario === "save-error",
  }),
  read: (state, { path }) => {
    if (path === "/api/admin/organization-settings") return { settings };
    if (path === "/api/admin/photo-capture-tasks") return { tasks: state.tasks, version: state.version };
    if (path.startsWith("/api/")) return {};
  },
  write: (state, { path, body }, { role }) => {
    if (path !== "/api/admin/photo-capture-tasks") return undefined;
    if (role !== "admin") throw new Error("この操作の権限がありません");
    if (state.failNext) { state.failNext = false; throw new Error("保存できませんでした。もう一度お試しください"); }
    if (body.version !== state.version) throw new Error("別の管理者が先に変更しました");
    state.tasks = body.tasks as PhotoCaptureTask[];
    state.version += 1;
    return { tasks: state.tasks, version: state.version };
  },
};
