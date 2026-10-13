export const bankAccountTypes = ["ordinary", "current", "savings", "other"] as const;
export type BankAccountType = typeof bankAccountTypes[number];
export const bankAccountTypeLabels: Record<BankAccountType, string> = { ordinary: "普通", current: "当座", savings: "貯蓄", other: "その他" };
export type BankAccount = { bankName: string; bankNo: string; bankHolder: string; bankBranch?: string; bankType?: BankAccountType | ""; bankTypeOther?: string };
export type BankStorage = { bank_name: string | null; bank_no: string | null; bank_holder: string | null; bank_branch_name?: string | null; bank_account_type?: BankAccountType | null; bank_account_type_other?: string | null };
export const legacyBankFields = ["bankName", "bankNo", "bankHolder"] as const;
export const bankFields = ["bankName", "bankBranch", "bankType", "bankNo", "bankHolder", "bankTypeOther"] as const;
export const hasBankDetails = (bank: BankAccount) => bankFields.some(key => !!bank[key]?.trim());
export const bankAccountTypeDisplay = (bank: BankAccount) => bank.bankType === "other" ? bank.bankTypeOther || "その他" : bank.bankType ? bankAccountTypeLabels[bank.bankType] : "";
/** 明示された独立項目を優先し、過渡期の銀行＋支店ミラーも読める。旧文字列は推測分割しない。 */
export function bankAccountFromStorage(bank: BankStorage): BankAccount {
  const combined = bank.bank_name ?? "";
  const suffix = bank.bank_branch_name ? ` ${bank.bank_branch_name}` : "";
  return { bankName: suffix && combined.endsWith(suffix) ? combined.slice(0, -suffix.length) : combined,
    bankNo: bank.bank_no ?? "", bankHolder: bank.bank_holder ?? "",
    ...(bank.bank_branch_name ? { bankBranch: bank.bank_branch_name } : {}),
    ...(bank.bank_account_type ? { bankType: bank.bank_account_type, ...(bank.bank_account_type === "other" ? { bankTypeOther: bank.bank_account_type_other ?? "" } : {}) } : {}) };
}
/** 旧形式を入力欄だけで分離する。支店は利用者が明示した末尾だけを分離し、保存値は更新しない。 */
export function bankAccountFormValues(bank: BankAccount, explicitBranch?: string): BankAccount {
  const suffix = explicitBranch?.trim() ? ` ${explicitBranch.trim()}` : "";
  const bankName = !bank.bankBranch && suffix && bank.bankName.endsWith(suffix) ? bank.bankName.slice(0, -suffix.length) : bank.bankName;
  const text = bank.bankNo.normalize("NFKC").trim();
  const known = text.match(/^(?:(普通|当座|貯蓄)\s*)?(\d{1,8})$/);
  const candidate = !known ? text.match(/^(.+?)\s+(\d{1,8})$/) : null;
  const custom = candidate && /[^\d\s]/.test(candidate[1]) ? candidate : null;
  if (!known && !custom) return { ...bank, bankName };
  const type = known?.[1] ? bankAccountTypes.find(value => bankAccountTypeLabels[value] === known[1]) : custom ? "other" : undefined;
  const other = custom?.[1].trim();
  return { ...bank, bankName, bankNo: (known ?? custom)![2],
    ...(type && !bank.bankType ? { bankType: type, ...(type === "other" ? { bankTypeOther: other === "その他" ? "" : other } : {}) } : {}) };
}
export function bankAccountInputError(bank: BankAccount): { field: typeof bankFields[number]; message: string } | null {
  for (const [field, message] of [
    ["bankName", "銀行名を入力してください"], ["bankBranch", "支店名を入力してください"],
    ["bankType", "口座種別を選んでください"], ["bankNo", "口座番号を入力してください"],
    ["bankHolder", "口座名義（カナ）を入力してください"],
  ] as const) if (!bank[field]?.trim()) return { field, message };
  if (!bankAccountTypes.includes(bank.bankType as BankAccountType)) return { field: "bankType", message: "口座種別を選んでください" };
  if (bank.bankType === "other" && (!bank.bankTypeOther?.trim() || bank.bankTypeOther.trim() === "その他")) return { field: "bankTypeOther", message: "種別名を入力してください" };
  if (bank.bankType === "other" && bank.bankTypeOther!.trim().length > 40) return { field: "bankTypeOther", message: "口座種別は40文字以内で入力してください" };
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
  if (["bankBranch", "bankType", "bankTypeOther"].some(key => Object.hasOwn(source, key))) {
    if (typeof source.bankBranch !== "string" || !source.bankBranch.trim() || !bankAccountTypes.includes(source.bankType as BankAccountType)) return null;
    bank.bankBranch = source.bankBranch.trim(); bank.bankType = source.bankType as BankAccountType;
    if (bank.bankType === "other") {
      if (typeof source.bankTypeOther !== "string" || !source.bankTypeOther.trim() || source.bankTypeOther.trim() === "その他" || source.bankTypeOther.trim().length > 40) return null;
      bank.bankTypeOther = source.bankTypeOther.trim();
    }
  }
  return bank;
}
/** 新規保存は独立6項目。古い3項目クライアントは原文を保つ。 */
export function bankAccountToStorage(bank: BankAccount): BankStorage {
  return { bank_name: bank.bankName.trim() || null, bank_no: bank.bankNo.trim() || null, bank_holder: bank.bankHolder.trim() || null,
    ...(bank.bankBranch !== undefined || bank.bankType !== undefined ? { bank_branch_name: bank.bankBranch?.trim() || null, bank_account_type: bank.bankType || null, bank_account_type_other: bank.bankType === "other" ? bank.bankTypeOther?.trim() || null : null } : {}) };
}

/** 旧3項目の表示契約を使う帳票・プロフィールには結合表記で返す。保存形式は変えない。 */
export function bankAccountLegacyDisplay(row: BankStorage) {
  const bank = bankAccountFromStorage(row);
  return { bankName: [bank.bankName, bank.bankBranch].filter(Boolean).join(" "), bankNo: bank.bankType && /^\d{1,8}$/.test(bank.bankNo) ? [bankAccountTypeDisplay(bank), bank.bankNo].filter(Boolean).join(" ") : bank.bankNo, bankHolder: bank.bankHolder };
}
