import { bankAccountTypes, bankFields, bankAccountToStorage, type BankAccount } from "./bankAccount";
/** 管理画面は未入力の口座も保存できる。口座を送らない更新では一切触らない。 */
export function adminBankAccountUpdates(body: Record<string, unknown>): Record<string, unknown> {
  if (!bankFields.some(key => Object.hasOwn(body, key))) return {};
  const structured = ["bankBranch", "bankType", "bankTypeOther"].some(key => Object.hasOwn(body, key));
  if (!structured) {
    const updates: Record<string, unknown> = {};
    for (const [key, column] of [["bankName", "bank_name"], ["bankNo", "bank_no"], ["bankHolder", "bank_holder"]] as const)
      if (Object.hasOwn(body, key)) updates[column] = typeof body[key] === "string" ? body[key].trim() || null : null;
    // 旧画面の結合保存で、独立項目が以前の口座のまま残ることを防ぐ。
    if (Object.hasOwn(body, "bankName")) updates.bank_branch_name = null;
    if (Object.hasOwn(body, "bankNo")) { updates.bank_account_type = null; updates.bank_account_type_other = null; }
    return updates;
  }
  if (!bankFields.every(key => Object.hasOwn(body, key) && (body[key] === null || typeof body[key] === "string"))) throw new Error("口座情報を読み込み直してください");
  const bank = Object.fromEntries(bankFields.map(key => [key, typeof body[key] === "string" ? body[key].trim() : ""])) as BankAccount;
  if (bank.bankNo && !/^\d{1,8}$/.test(bank.bankNo)) throw new Error("口座番号は8桁以内の数字だけで入力してください");
  if (bank.bankType && !bankAccountTypes.includes(bank.bankType)) throw new Error("口座種別を選び直してください");
  if (bank.bankType === "other" && (!bank.bankTypeOther || bank.bankTypeOther === "その他" || bank.bankTypeOther.length > 40)) throw new Error("種別名を40文字以内で入力してください");
  return bankAccountToStorage(bank);
}
