// 本番の請求書編集・プレビューページを再利用。値はすべて架空。
import type { PreviewFixture } from "@/lib/preview/fixtureStore";
import { blankEditorState, payloadFromEditor } from "@/app/(admin)/admin/(accounting)/invoices/_components/editorModel";

const id = "preview-invoice";
function createInvoice(scenario: string, invoiceId = id) {
  if (scenario === "individual") {
    const state = {
      ...blankEditorState("incoming"), id: invoiceId,
      toName: "プレビュー運送株式会社", toAddrHtml: "〒100-0000<br/>東京都架空区一丁目",
      toTel: "03-0000-0000", toReg: "T0000000000000",
      fromName: "架空 太郎", fromAddrHtml: "〒150-0000<br/>東京都サンプル区二丁目",
      period: "2026年9月1日〜2026年9月30日", invoiceNo: "PREVIEW-IND-001",
      bankName: "架空銀行 サンプル支店", bankNo: "普通 0000000", bankHolder: "カクウ タロウ",
      main: [{ title: "単発配送", qty: "1", price: "20000", unit: "回", priceBasis: "exclusive" as const }],
      deduct: [], parties: { fromParty: "individual", toParty: "ace_creation" },
    };
    return { id: invoiceId, clientName: state.fromName, invoiceNo: state.invoiceNo, direction: "incoming", status: "draft", payload: payloadFromEditor(state) };
  }
  const state = { ...blankEditorState("outgoing"), id: invoiceId,
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
  return { id: invoiceId, clientName: state.toName, invoiceNo: state.invoiceNo, direction: "outgoing", status: "draft", payload: payloadFromEditor(state) };
}
type State = { invoice: ReturnType<typeof createInvoice> | null };
const base: PreviewFixture<State> = {
  id: "invoice-preview", title: "請求書プレビュー", pathname: `/admin/invoices/${id}/preview`, params: { id },
  scenarios: {
    normal: { label: "通常", description: "既存の改行を含む住所" },
    individual: { label: "未登録の個人", description: "単発配送の受領請求書" },
    empty: { label: "対象なし", description: "請求書が見つからない状態" },
    "long-name": { label: "長い住所・明細", description: "建物名の折り返し" },
    large: { label: "複数ページ", description: "45行の明細" },
    "unsafe-address": { label: "特殊文字の住所", description: "タグを文字列として表示し、実行しない" },
  },
  createState: ({ scenario }) => ({ invoice: scenario === "empty" ? null : createInvoice(scenario) }),
  read(state, { path }) {
    if (path === `/api/admin/invoices/${state.invoice?.id ?? id}`) return { invoice: state.invoice };
    if (path === "/api/admin/invoice-addresses") return { addresses: [] };
    if (path === "/api/admin/users") return { drivers: [] };
    if (path === "/api/admin/organization-settings") return { settings: { name: "プレビュー運送株式会社", stampUrl: null } };
  },
  write(state, { path, body }, { role }) {
    if (role === "viewer") throw new Error("この操作の権限がありません。");
    if (path === `/api/admin/invoices/${state.invoice?.id ?? id}` && state.invoice) {
      state.invoice = { ...state.invoice, ...body, id: state.invoice.id };
      return { invoice: state.invoice };
    }
  },
};
export const invoicePreviewFixture = base;
export const invoiceEditFixture: PreviewFixture<State> = { ...base, id: "invoice-edit", title: "請求書編集", pathname: `/admin/invoices/${id}/edit` };
const individualId = "preview-individual-invoice";
const individualBase: PreviewFixture<State> = {
  ...base,
  params: { id: individualId },
  scenarios: { normal: { label: "通常", description: "未登録の個人からの請求書" } },
  createState: () => ({ invoice: createInvoice("individual", individualId) }),
};
export const individualInvoicePreviewFixture: PreviewFixture<State> = {
  ...individualBase, id: "invoice-individual-preview", title: "個人の請求書プレビュー", pathname: `/admin/invoices/${individualId}/preview`,
};
export const individualInvoiceEditFixture: PreviewFixture<State> = {
  ...individualBase, id: "invoice-individual-edit", title: "個人の請求書編集", pathname: `/admin/invoices/${individualId}/edit`,
};

type InvoiceListState = { invoices: Record<string, unknown>[] };
const previewMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
const individualInvoice = {
  id: "preview-individual-invoice", month: previewMonth, direction: "incoming", clientName: "架空 太郎",
  counterpartyName: "架空 太郎", issueDate: "", amount: 22000, status: "draft", invoiceNo: "PREVIEW-IND-001",
};
const corporateInvoice = {
  id, month: previewMonth, direction: "outgoing", clientName: "サンプル配送株式会社",
  counterpartyName: "サンプル配送株式会社", issueDate: "", amount: 22000, status: "draft", invoiceNo: "PREVIEW-001",
};

export const invoiceListFixture: PreviewFixture<InvoiceListState> = {
  id: "invoice-list", title: "請求書一覧", pathname: "/admin/invoices",
  scenarios: {
    normal: { label: "通常", description: "法人と個人の請求書" },
    empty: { label: "対象なし", description: "請求書がない月" },
    "long-name": { label: "長い氏名", description: "個人名の折り返し" },
    large: { label: "多数", description: "請求書が多い月" },
  },
  createState: ({ scenario }) => ({ invoices: scenario === "empty" ? [] : [
    corporateInvoice,
    { ...individualInvoice, counterpartyName: scenario === "long-name" ? "架空 長い氏名が続く配送スタッフ 太郎" : individualInvoice.counterpartyName },
    ...(scenario === "large" ? Array.from({ length: 30 }, (_, i) => ({ ...individualInvoice, id: `preview-person-${i}`, invoiceNo: `SAMPLE-${i + 10}` })) : []),
  ] }),
  read(state, { path, params }) {
    if (path === "/api/admin/invoices" && params.get("months") === "1") return { months: [previewMonth] };
    if (path === "/api/admin/invoices") return { invoices: state.invoices.filter((invoice) => invoice.month === params.get("month")) };
    if (path === "/api/admin/users") return { drivers: [{ id: "preview-driver", name: "登録済み 花子" }] };
    if (path === "/api/admin/invoice-addresses") return { addresses: [{ id: "preview-address", name: "サンプル配送株式会社" }] };
  },
  write(state, { path, body, method }, { role }) {
    if (role === "viewer") throw new Error("この操作の権限がありません。");
    if (path === "/api/admin/invoices" && method === "POST") {
      const invoice = { ...body, id: `preview-created-${state.invoices.length}`, month: body.month ?? previewMonth };
      state.invoices.push(invoice);
      return { invoice };
    }
    if (path.startsWith("/api/admin/invoices/") && method === "PATCH") {
      const invoice = state.invoices.find((item) => item.id === path.split("/").at(-1));
      if (invoice) Object.assign(invoice, body);
      return { invoice };
    }
  },
};

export const invoiceNewFixture: PreviewFixture<{ invoice: Record<string, unknown> | null }> = {
  id: "invoice-new", title: "請求書作成", pathname: "/admin/invoices/new",
  scenarios: {
    normal: { label: "通常", description: "未登録の個人からの受領請求書を作る" },
  },
  createState: () => ({ invoice: null }),
  read(_state, { path }) {
    if (path === "/api/admin/organization-settings") return { settings: { name: "プレビュー運送株式会社", stampUrl: null, invoice_postal_code: "100-0000", invoice_address: "東京都架空区一丁目", invoice_tel: "03-0000-0000", invoice_registration_no: "", invoice_bank_name: "架空銀行", invoice_bank_no: "普通 0000000", invoice_bank_holder: "プレビューウンソウ" } };
    if (path === "/api/admin/invoice-addresses") return { addresses: [] };
    if (path === "/api/admin/users") return { drivers: [] };
  },
  write(state, { path, body, method }, { role }) {
    if (role === "viewer") throw new Error("この操作の権限がありません。");
    if (path === "/api/admin/invoices" && method === "POST") {
      state.invoice = { ...body, id: "preview-new-individual" };
      return { invoice: state.invoice };
    }
    if (path === "/api/admin/invoices/preview-new-individual" && method === "PATCH") {
      state.invoice = { ...state.invoice, ...body, id: "preview-new-individual" };
      return { invoice: state.invoice };
    }
  },
};
