import { bankCleanupRow, sameBankStorage, type BankCleanupDriver, type BankCleanupRow } from "@/lib/bankCleanup";
import type { PreviewFixture } from "@/lib/preview/fixtureStore";
const original = (id: string, name: string, bank_name: string, bank_no = "普通 01234567"): BankCleanupDriver => ({ id, name, driver_code: `TST${id.padStart(6, "0")}`, bank_name, bank_no, bank_holder: "ミホン タロウ", bank_branch_name: null, bank_account_type: null, bank_account_type_other: null });
export const bankCleanupFixture: PreviewFixture<{ drivers: BankCleanupDriver[]; failed: boolean }> = {
  id: "bank-cleanup", title: "口座情報の整理", pathname: "/admin/users/bank-cleanup",
  scenarios: { normal: { label: "通常", description: "半角・全角の空白と確認が必要な口座" }, "save-error": { label: "保存失敗", description: "一行だけ初回保存失敗、再試行" }, conflict: { label: "他端末で変更", description: "確認後に変わった口座を上書きしない" }, empty: { label: "対象なし", description: "すべて新形式" }, large: { label: "大量", description: "100件ずつ確認" } },
  createState: c => ({ failed: false, drivers: c.scenario === "empty" ? [] : c.scenario === "large" ? Array.from({ length: 105 }, (_, i) => original(String(i + 1), `見本${i + 1}`, "見本銀行 中央支店")) : [original("1", "見本 太郎", "見本銀行 中央支店"), original("2", "見本 花子", "見本信用金庫　東支店", "貯蓄　００１２３４５"), original("3", "見本 次郎", "見本銀行 東京 中央支店"), original("4", "見本 三郎", "見本銀行 西支店", "別段 0001234")] }),
  read: (state, request) => {
    if (request.path !== "/api/admin/bank-cleanup") return undefined;
    const cursor = Number(request.params.get("cursor") ?? 0);
    const page = state.drivers.slice(cursor, cursor + 100);
    return { rows: page.map(bankCleanupRow).filter((row): row is BankCleanupRow => !!row), nextCursor: page.length === 100 ? cursor + 100 : null };
  },
  write: (state, request, c) => {
    if (request.path !== "/api/admin/bank-cleanup" || request.method !== "POST") return undefined;
    if (c.role !== "admin") throw new Error("保存する権限がありません");
    const driver = state.drivers.find(row => row.id === request.body.id);
    if (!driver) throw new Error("対象が見つかりません");
    if (c.scenario === "conflict" && driver.id === "1") { driver.bank_no = "9876543"; throw new Error("口座情報が変わっています。再読み込みして確認してください"); }
    if (c.scenario === "save-error" && driver.id === "2" && !state.failed) { state.failed = true; throw new Error("保存できませんでした。再試行してください"); }
    const candidate = bankCleanupRow(driver)?.candidate;
    if (!candidate || !sameBankStorage(driver, request.body.before as BankCleanupDriver) || !sameBankStorage(candidate, request.body.candidate as BankCleanupDriver)) throw new Error("口座情報が変わっています。再読み込みして確認してください");
    Object.assign(driver, candidate); return { ok: true };
  },
};
