export const bankAccountTypes = ["ordinary", "current", "savings"] as const;
export type BankAccountType = typeof bankAccountTypes[number];
export const bankAccountTypeLabels: Record<BankAccountType, string> = { ordinary: "普通", current: "当座", savings: "貯蓄" };
export type BankAccount = { bankName: string; bankNo: string; bankHolder: string; bankBranch?: string; bankType?: BankAccountType | "" };
export const legacyBankFields = ["bankName", "bankNo", "bankHolder"] as const;
export const bankFields = ["bankName", "bankBranch", "bankType", "bankNo", "bankHolder"] as const;
export const hasBankDetails = (bank: BankAccount) => bankFields.some(key => !!bank[key]?.trim());
/** 旧形式の種別つき番号は入力欄だけで分離する。保存値・確認情報は自動更新しない。 */
export function bankAccountFormValues(bank: BankAccount, explicitBranch?: string): BankAccount {
  const suffix = explicitBranch?.trim() ? ` ${explicitBranch.trim()}` : "";
  const bankName = !bank.bankBranch && suffix && bank.bankName.endsWith(suffix) ? bank.bankName.slice(0, -suffix.length) : bank.bankName;
  const match = bank.bankNo.normalize("NFKC").trim().match(/^(?:(普通|当座|貯蓄)\s*)?(\d{1,8})$/);
  if (!match) return { ...bank, bankName };
  const type = bankAccountTypes.find(value => bankAccountTypeLabels[value] === match[1]);
  return { ...bank, bankName, bankNo: match[2], ...(type && !bank.bankType ? { bankType: type } : {}) };
}
export function bankAccountInputError(bank: BankAccount): { field: typeof bankFields[number]; message: string } | null {
  for (const [field, message] of [
    ["bankName", "銀行名を入力してください"], ["bankBranch", "支店名を入力してください"],
    ["bankType", "口座種別を選んでください"], ["bankNo", "口座番号を入力してください"],
    ["bankHolder", "口座名義（カナ）を入力してください"],
  ] as const) if (!bank[field]?.trim()) return { field, message };
  if (!bankAccountTypes.includes(bank.bankType as BankAccountType)) return { field: "bankType", message: "口座種別を選んでください" };
  if (!/^\d{1,8}$/.test(bank.bankNo.trim())) return { field: "bankNo", message: "口座番号は8桁以内の数字だけで入力してください" };
  return null;
}
/** 空欄の初回入力は許可し、既に保存した項目の変更には本人確認を求める。 */
export const requiresBankChangePasskey = (before: BankAccount, after: BankAccount) => {
  const previous = bankAccountFormValues(before, after.bankBranch);
  return (legacyBankFields.every(key => !!before[key].trim()) && bankFields.some(key => (previous[key] ?? "").trim() !== (after[key] ?? ""))) ||
    bankFields.some(key => !!previous[key]?.trim() && previous[key]?.trim() !== (after[key] ?? ""));
};
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
