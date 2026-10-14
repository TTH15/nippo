import { expect, it } from "vitest";
import { bankAccountFormValues, bankAccountInputError, normalizeBankAccount, requiresBankChangePasskey } from "./bankAccount";
const old = { bankName: "見本銀行 中央支店", bankNo: "普通 01234567", bankHolder: "" };
it.each([["普通 01234567", "ordinary"], ["当座　０１２３４５６７", "current"], ["貯蓄1234567", "savings"]])("旧番号%sは先頭0を保ち種別を分離する", (bankNo, bankType) => {
  expect(bankAccountFormValues({ ...old, bankNo })).toEqual({ ...old, bankNo: bankNo.includes("貯蓄") ? "1234567" : "01234567", bankType });
  expect(old.bankNo).toBe("普通 01234567");
});
it.each(["普通 123A4567", "普通 123456789", "123 4567"])("曖昧な番号%sを推測して変えない", bankNo => {
  expect(bankAccountFormValues({ ...old, bankNo }).bankNo).toBe(bankNo);
});
it("既存の明示種別を上書きしない", () => {
  expect(bankAccountFormValues({ ...old, bankType: "current" }).bankType).toBe("current");
});
it("旧形式の表記整理と不足項目の補完だけなら本人確認を求めず、実際の変更は保護する", () => {
  const after = { ...bankAccountFormValues(old, "中央支店"), bankBranch: "中央支店", bankHolder: "ミホン" };
  expect(requiresBankChangePasskey(old, after)).toBe(false);
  expect(requiresBankChangePasskey(old, { ...after, bankNo: "9999999" })).toBe(true);
  expect(requiresBankChangePasskey(old, { ...after, bankType: "current" })).toBe(true);
  expect(requiresBankChangePasskey({ ...old, bankHolder: "ミホン" }, after)).toBe(true);
});
it("口座番号の不正を他の項目と区別する", () => {
  const filled = { ...old, bankHolder: "ミホン", bankBranch: "中央支店", bankType: "ordinary" as const };
  expect(bankAccountInputError(filled)).toEqual({ field: "bankNo", message: "口座番号は8桁以内の数字だけで入力してください" });
  expect(bankAccountInputError({ ...filled, bankBranch: "" })?.field).toBe("bankBranch");
  expect(normalizeBankAccount(filled)).toBeNull();
});

it("支店は利用者が明示して旧表記と一致するときだけ分離する", () => {
 expect(bankAccountFormValues(old).bankName).toBe("見本銀行 中央支店");
 expect(bankAccountFormValues(old, "中央支店").bankName).toBe("見本銀行");
 expect(bankAccountFormValues(old, "別支店").bankName).toBe(old.bankName);
 const filled = { ...bankAccountFormValues(old, "中央支店"), bankBranch: "中央支店", bankHolder: "ミホン" };
 expect(requiresBankChangePasskey(old, { ...filled, bankName: "別銀行" })).toBe(true);
});
