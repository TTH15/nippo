export const bankAccountTypes = ["ordinary", "current", "savings"] as const;
export type BankAccountType = typeof bankAccountTypes[number];
export const bankAccountTypeLabels: Record<BankAccountType, string> = { ordinary: "普通", current: "当座", savings: "貯蓄" };
export type BankAccount = { bankName: string; bankNo: string; bankHolder: string; bankBranch?: string; bankType?: BankAccountType | "" };
export const legacyBankFields = ["bankName", "bankNo", "bankHolder"] as const;
export const bankFields = ["bankName", "bankBranch", "bankType", "bankNo", "bankHolder"] as const;
export const hasBankDetails = (bank: BankAccount) => bankFields.some(key => !!bank[key]?.trim());
/** 空欄の初回入力は許可し、既に保存した項目の変更には本人確認を求める。 */
export const requiresBankChangePasskey = (before: BankAccount, after: BankAccount) =>
  (legacyBankFields.every(key => !!before[key].trim()) && bankFields.some(key => (before[key] ?? "").trim() !== (after[key] ?? ""))) ||
  bankFields.some(key => !!before[key]?.trim() && before[key]?.trim() !== (after[key] ?? ""));
export function normalizeBankAccount(value: unknown): BankAccount | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  if (!legacyBankFields.every(key => typeof source[key] === "string")) return null;
  const bank = Object.fromEntries(legacyBankFields.map(key => [key, (source[key] as string).trim()])) as BankAccount;
  if (!bank.bankName || !bank.bankHolder || !/^\d{1,8}$/.test(bank.bankNo)) return null;
  // 旧クライアントの3項目は維持。新しい項目を送る場合は支店・種別を揃える。
  if (Object.hasOwn(source, "bankBranch") || Object.hasOwn(source, "bankType")) {
    if (typeof source.bankBranch !== "string" || !source.bankBranch.trim() || !bankAccountTypes.includes(source.bankType as BankAccountType)) return null;
    bank.bankBranch = source.bankBranch.trim(); bank.bankType = source.bankType as BankAccountType;
  }
  return bank;
}
