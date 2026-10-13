import { expect, it } from "vitest";
import { adminBankAccountUpdates } from "./adminBankAccount";
import { bankAccountFromStorage, bankAccountFormValues, bankAccountLegacyDisplay, normalizeBankAccount } from "./bankAccount";
const bank = { bankName: "見本銀行", bankBranch: "中央支店", bankNo: "01234567", bankHolder: "ミホン", bankType: "other", bankTypeOther: "別段" };
it("管理画面とユーザー画面は同じ独立項目で保存し、その他の具体名と先頭0を往復できる", () => {
 const row = adminBankAccountUpdates(bank);
 expect(row).toEqual({ bank_name: "見本銀行", bank_branch_name: "中央支店", bank_no: "01234567", bank_holder: "ミホン", bank_account_type: "other", bank_account_type_other: "別段" });
 const value = bankAccountFromStorage(row as Parameters<typeof bankAccountFromStorage>[0]);
 expect(value).toEqual(bank); expect(normalizeBankAccount(value)).toEqual(bank);
 expect(bankAccountLegacyDisplay(row as Parameters<typeof bankAccountFromStorage>[0])).toEqual({ bankName: "見本銀行 中央支店", bankNo: "別段 01234567", bankHolder: "ミホン" });
});
it("空口座・一部入力は許可し、具体名欠落と不正番号はDB更新前に拒否する", () => {
 expect(adminBankAccountUpdates(Object.fromEntries(Object.keys(bank).map(k => [k, ""])))) .toEqual({ bank_name: null, bank_branch_name: null, bank_no: null, bank_holder: null, bank_account_type: null, bank_account_type_other: null });
 expect(() => adminBankAccountUpdates({ ...bank, bankTypeOther: "" })).toThrow("具体的");
 expect(() => adminBankAccountUpdates({ ...bank, bankNo: "普通 1234567" })).toThrow("数字");
 expect(() => adminBankAccountUpdates({ ...bank, bankTypeOther: "あ".repeat(41) })).toThrow("40文字");
 expect(adminBankAccountUpdates({ ...bank, bankType: "ordinary", bankTypeOther: "" })).toMatchObject({ bank_account_type: "ordinary", bank_account_type_other: null });
});
it("口座以外の保存は旧形式・新形式とも口座に触れず、旧クライアントが口座変更したら古いメタデータを残さない", () => {
 expect(adminBankAccountUpdates({ name: "変更後" })).toEqual({});
 expect(adminBankAccountUpdates({ bankName: "旧銀行 旧支店", bankNo: "別段 01234567" })).toEqual({ bank_name: "旧銀行 旧支店", bank_no: "別段 01234567", bank_branch_name: null, bank_account_type: null, bank_account_type_other: null });
 expect(adminBankAccountUpdates({ bankHolder: "ミホン" })).toEqual({ bank_holder: "ミホン" });
});
it("旧その他の種別名を勝手に普通へ変えず、未知の番号を推測しない", () => {
 expect(bankAccountFormValues({ bankName: "旧銀行 旧支店", bankNo: "別段 ０１２３４５６７", bankHolder: "ミホン" })).toMatchObject({ bankNo: "01234567", bankType: "other", bankTypeOther: "別段" });
 expect(bankAccountFormValues({ bankName: "旧銀行", bankNo: "別段2 01234567", bankHolder: "ミホン" })).toMatchObject({ bankNo: "01234567", bankTypeOther: "別段2" });
 expect(bankAccountFormValues({ bankName: "旧銀行", bankNo: "123 4567", bankHolder: "ミホン" }).bankNo).toBe("123 4567");
});
