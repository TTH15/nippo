// 隔離プレビュー専用。実口座・個人情報を使わず、保存先はメモリのみ。
export type AccountScenario = "normal" | "missing" | "error" | "loading";
let scenario: AccountScenario = "normal", failed = false;
let bank = { bankName: "サンプル銀行 中央支店", bankNo: "1234567", bankHolder: "サンプル タロウ" };
export function setAccountScenario(next: AccountScenario) {
  scenario = next; failed = false;
  bank = next === "missing" ? { bankName: "", bankNo: "", bankHolder: "" } : { bankName: "サンプル銀行 中央支店", bankNo: "1234567", bankHolder: "サンプル タロウ" };
}
export async function previewAccountBank(body?: Record<string, unknown>) {
  if (scenario === "loading") return new Promise<typeof bank>(() => {});
  if (scenario === "error" && !failed) { failed = true; throw new Error("振込口座を取得できませんでした"); }
  if (body) bank = { bankName: String(body.bankName || ""), bankNo: String(body.bankNo || ""), bankHolder: String(body.bankHolder || "") };
  return { ...bank };
}
export function previewAccountProfile() {
  return { name: "サンプル 太郎", displayName: "サンプル", phone: "09000000000", phoneVerified: true, driverCode: "SAMPLE", officeCode: "DEMO", postalCode: "0000000", address: "サンプル市中央1丁目（架空）", identities: [{ id: "preview-identity", name: "業務委託", label: "業務委託" }], ...bank };
}
