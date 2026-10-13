export type BankAccount = { bankName: string; bankNo: string; bankHolder: string };
export const bankFields = ["bankName", "bankNo", "bankHolder"] as const;
export const hasBankDetails = (bank: BankAccount) => bankFields.some(key => !!bank[key]?.trim());
/** 空欄の初回入力は許可し、既に保存した項目の変更には本人確認を求める。 */
export const requiresBankChangePasskey = (before: BankAccount, after: BankAccount) => bankFields.some(key => !!before[key].trim() && before[key].trim() !== after[key]);
export function normalizeBankAccount(value: unknown): BankAccount | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  if (!bankFields.every(key => typeof source[key] === "string")) return null;
  const bank = Object.fromEntries(bankFields.map(key => [key, (source[key] as string).trim()])) as BankAccount;
  return bank.bankName && bank.bankHolder && /^\d{1,8}$/.test(bank.bankNo) ? bank : null;
}
