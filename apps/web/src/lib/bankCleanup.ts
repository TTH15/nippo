import { bankAccountFromStorage, bankAccountFormValues, bankAccountToStorage, type BankStorage } from "./bankAccount";
import { adminBankAccountUpdates } from "./adminBankAccount";
export const bankStorageFields = ["bank_name", "bank_branch_name", "bank_account_type", "bank_account_type_other", "bank_no", "bank_holder"] as const;
export type BankCleanupDriver = BankStorage & { id: string; name: string; driver_code: string | null };
export type BankCleanupRow = { driver: BankCleanupDriver; candidate: BankStorage | null; reason: string };
export function bankCleanupRow(driver: BankCleanupDriver): BankCleanupRow | null {
  const original = bankAccountFromStorage(driver);
  const bank = bankAccountFormValues(original);
  const combined = original.bankName.trim();
  let ambiguous = false;
  if (!original.bankBranch && /\s/.test(combined)) {
    // 金融機関・支店が明確な2項目だけを候補にする。名前内の空白は推測しない。
    const parts = combined.split(/\s+/);
    if (parts.length === 2 && /(?:銀行|信用金庫|信用組合|労働金庫|農業協同組合|農協)$/.test(parts[0]) && /(?:支店|本店|出張所|営業部)$/.test(parts[1])) {
      bank.bankName = parts[0]; bank.bankBranch = parts[1];
    } else ambiguous = true;
  }
  if (bank.bankNo && !/^\d{1,8}$/.test(bank.bankNo)) ambiguous = true;
  // 独立種別と旧番号の種別が矛盾する場合は自動候補を出さない。
  const inferred = bankAccountFormValues({ ...original, bankType: "", bankTypeOther: "" });
  if (original.bankType && inferred.bankType && (original.bankType !== inferred.bankType || (original.bankType === "other" && original.bankTypeOther !== inferred.bankTypeOther))) ambiguous = true;
  const next = { ...driver, ...bankAccountToStorage({ ...bank, bankBranch: bank.bankBranch ?? "", bankType: bank.bankType ?? "", bankTypeOther: bank.bankTypeOther ?? "" }) };
  next.bank_holder = driver.bank_holder;
  const changed = bankStorageFields.some(key => (driver[key] ?? null) !== (next[key] ?? null));
  if (!changed && !ambiguous) return null;
  if (ambiguous) return { driver, candidate: null, reason: "分け方を確認してください" };
  try { adminBankAccountUpdates({ ...bank, bankBranch: bank.bankBranch ?? "", bankType: bank.bankType ?? "", bankTypeOther: bank.bankTypeOther ?? "" }); }
  catch { return { driver, candidate: null, reason: "種別名を確認してください" }; }
  return { driver, candidate: Object.fromEntries(bankStorageFields.map(key => [key, next[key] ?? null])) as BankStorage, reason: "" };
}
export const sameBankStorage = (a: BankStorage, b: BankStorage) => bankStorageFields.every(key => (a[key] ?? null) === (b[key] ?? null));
