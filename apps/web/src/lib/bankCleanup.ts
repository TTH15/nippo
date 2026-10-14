import { bankAccountFromStorage, bankAccountFormValues, bankAccountToStorage, type BankStorage } from "./bankAccount";
import { adminBankAccountUpdates } from "./adminBankAccount";
export const bankStorageFields = ["bank_name", "bank_branch_name", "bank_account_type", "bank_account_type_other", "bank_no", "bank_holder"] as const;
export type BankCleanupDriver = BankStorage & { id: string; name: string; driver_code: string | null };
export type BankCleanupRow = { driver: BankCleanupDriver; candidate: BankStorage | null; reason: string };
export function bankCleanupRow(driver: BankCleanupDriver): BankCleanupRow | null {
  const original = bankAccountFromStorage(driver);
  const bank = bankAccountFormValues(original);
  const combined = original.bankName.trim();
  let reason = "";
  if (!original.bankBranch && /\s/.test(combined)) {
    // 金融機関・支店が明確な2項目だけを候補にする。名前内の空白は推測しない。
    const parts = combined.split(/\s+/);
    if (parts.length === 2 && /(?:支店|本店|出張所|営業部)$/.test(parts[1])) {
      bank.bankName = parts[0]; bank.bankBranch = parts[1];
    } else reason = parts.length > 2 ? "銀行名と支店名の区切りが複数あります" : "支店名の区切りを特定できません";
  }
  if (bank.bankNo && !/^\d{1,8}$/.test(bank.bankNo)) reason = "口座番号から数字を取り出せません";
  // 独立種別と旧番号の種別が矛盾する場合は自動候補を出さない。
  const inferred = bankAccountFormValues({ ...original, bankType: "", bankTypeOther: "" });
  if (original.bankType && inferred.bankType && (original.bankType !== inferred.bankType || (original.bankType === "other" && original.bankTypeOther !== inferred.bankTypeOther))) reason = "保存済みの種別と口座番号の種別が一致しません";
  const next = { ...driver, ...bankAccountToStorage({ ...bank, bankBranch: bank.bankBranch ?? "", bankType: bank.bankType ?? "", bankTypeOther: bank.bankTypeOther ?? "" }) };
  next.bank_holder = driver.bank_holder;
  const changed = bankStorageFields.some(key => (driver[key] ?? null) !== (next[key] ?? null));
  if (!changed && !reason) return null;
  if (reason) return { driver, candidate: null, reason };
  try { adminBankAccountUpdates({ ...bank, bankBranch: bank.bankBranch ?? "", bankType: bank.bankType ?? "", bankTypeOther: bank.bankTypeOther ?? "" }); }
  catch { return { driver, candidate: null, reason: "種別名を確認してください" }; }
  return { driver, candidate: Object.fromEntries(bankStorageFields.map(key => [key, next[key] ?? null])) as BankStorage, reason: "" };
}
export const sameBankStorage = (a: BankStorage, b: BankStorage) => bankStorageFields.every(key => (a[key] ?? null) === (b[key] ?? null));
