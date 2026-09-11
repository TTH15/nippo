// 本番の請求書編集・プレビューページを再利用。値はすべて架空。
import type { PreviewFixture } from "@/lib/preview/fixtureStore";
import { blankEditorState, payloadFromEditor } from "@/app/(admin)/admin/(accounting)/invoices/_components/editorModel";

const id = "preview-invoice";
function createInvoice(scenario: string) {
  const state = { ...blankEditorState("outgoing"), id,
    toName: "サンプル配送株式会社", fromName: "プレビュー運送株式会社",
    toAddrHtml: scenario === "unsafe-address" ? '〒100-0000<br/><img src=x onerror="window.__addressExecuted=true">\n検証ビル<別館>' : "〒100-0000<br/>東京都サンプル区一丁目<br/>配送ビル 2階",
    fromAddrHtml: scenario === "unsafe-address" ? '<svg onload="window.__addressExecuted=true"></svg><br/>請求元<本館>' : "〒150-0000<br/>東京都プレビュー区二丁目<br/>運送センター 3階",
    toTel: "03-0000-0000", fromTel: "03-0000-0000", toReg: "T0000000000000", fromReg: "T0000000000000", showStamp: false,
    bankName: "架空銀行 サンプル支店", bankNo: "普通 0000000", bankHolder: "プレビューウンソウ",
    period: "2026年9月1日〜2026年9月30日", invoiceNo: "PREVIEW-001", dueDate: "",
    main: Array.from({ length: scenario === "large" ? 45 : 2 }, (_, i) => ({ title: scenario === "long-name" ? "サンプル配送センターから集合住宅への配送業務（午前便・午後便・追加対応）" : `配送業務 ${i + 1}`, qty: "10", price: "1000", unit: "件", priceBasis: "exclusive" as const })),
    deduct: [], notes: "架空データによる確認用です。", parties: { fromParty: "ace_creation", toParty: "" },
  };
  if (scenario === "long-name") state.toAddrHtml += "<br/>" + "長い建物名・東棟連絡通路".repeat(5) + " 1001号室";
  return { id, clientName: state.toName, invoiceNo: state.invoiceNo, direction: "outgoing", status: "draft", payload: payloadFromEditor(state) };
}
type State = { invoice: ReturnType<typeof createInvoice> | null };
const base: PreviewFixture<State> = {
  id: "invoice-preview", title: "請求書プレビュー", pathname: `/admin/invoices/${id}/preview`, params: { id },
  scenarios: {
    normal: { label: "通常", description: "既存の改行を含む住所" },
    empty: { label: "対象なし", description: "請求書が見つからない状態" },
    "long-name": { label: "長い住所・明細", description: "建物名の折り返し" },
    large: { label: "複数ページ", description: "45行の明細" },
    "unsafe-address": { label: "特殊文字の住所", description: "タグを文字列として表示し、実行しない" },
  },
  createState: ({ scenario }) => ({ invoice: scenario === "empty" ? null : createInvoice(scenario) }),
  read(state, { path }) {
    if (path === `/api/admin/invoices/${id}`) return { invoice: state.invoice };
    if (path === "/api/admin/invoice-addresses") return { addresses: [] };
    if (path === "/api/admin/users") return { drivers: [] };
    if (path === "/api/admin/organization-settings") return { settings: { name: "プレビュー運送株式会社", stampUrl: null } };
  },
  write(state, { path, body }, { role }) {
    if (role === "viewer") throw new Error("この操作の権限がありません。");
    if (path === `/api/admin/invoices/${id}` && state.invoice) {
      state.invoice = { ...state.invoice, ...body, id };
      return { invoice: state.invoice };
    }
  },
};
export const invoicePreviewFixture = base;
export const invoiceEditFixture: PreviewFixture<State> = { ...base, id: "invoice-edit", title: "請求書編集", pathname: `/admin/invoices/${id}/edit` };
