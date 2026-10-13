import { expect, it } from "vitest";
import { bankCleanupRow, sameBankStorage, type BankCleanupDriver } from "./bankCleanup";
const row: BankCleanupDriver = { id: "1", name: "見本", driver_code: "TST1", bank_name: "見本銀行 中央支店", bank_no: "普通 01234567", bank_holder: "ミホン", bank_branch_name: null, bank_account_type: null, bank_account_type_other: null };
it.each([" ", "　", "  "])("空白%sの旧値を分離し先頭0・名義を維持", space => {
 const before = { ...row, bank_name: `見本銀行${space}中央支店` };
 expect(bankCleanupRow(before)?.candidate).toEqual({ bank_name: "見本銀行", bank_branch_name: "中央支店", bank_account_type: "ordinary", bank_account_type_other: null, bank_no: "01234567", bank_holder: "ミホン" });
 expect(before.bank_name).toBe(`見本銀行${space}中央支店`);
});
it.each(["見本銀行 東京 中央支店", "見本 銀行", "見本銀行 中央"])("曖昧な銀行名%sは手動確認", bank_name => { expect(bankCleanupRow({ ...row, bank_name })?.candidate).toBeNull(); });
it("独立項目は優先し、既に新形式なら候補なし", () => {
 const bank = { ...row, ...bankCleanupRow(row)!.candidate! };
 expect(bankCleanupRow(bank)).toBeNull();
 expect(bankCleanupRow({ ...row, bank_branch_name: "別支店" })?.candidate?.bank_branch_name).toBe("別支店");
});
it("明示種別との矛盾・壊れた番号は一括保存しない", () => {
 expect(bankCleanupRow({ ...row, bank_account_type: "current" })?.candidate).toBeNull();
 expect(bankCleanupRow({ ...row, bank_no: "普通 123A4567" })?.candidate).toBeNull();
});
it("その他具体名の分離と全角番号に対応", () => { expect(bankCleanupRow({ ...row, bank_no: "別段　００１２３４５" })?.candidate).toMatchObject({ bank_account_type: "other", bank_account_type_other: "別段", bank_no: "0012345" }); });
it("空口座は対象なし、名義欠落は勝手に補わない", () => {
 expect(bankCleanupRow({ ...row, bank_name: null, bank_no: null, bank_holder: null })).toBeNull();
 expect(bankCleanupRow({ ...row, bank_holder: null })?.candidate?.bank_holder).toBeNull();
});
it("比較は新メタデータも含める", () => { expect(sameBankStorage(row, { ...row, bank_account_type_other: "別段" })).toBe(false); });
