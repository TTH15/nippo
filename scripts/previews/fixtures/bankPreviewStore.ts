import { bankAccountFromStorage, type BankStorage } from "@/lib/bankAccount";
export const bankPreviewScenarios = {
  "bank-holder-full": { label: "全角名義", description: "全角で保存し振込出力だけ半角に変換" },
  "bank-holder-half": { label: "半角名義", description: "半角入力も原文を保持" },
  "bank-canonical": { label: "独立口座", description: "銀行・支店・種別・番号を別々に保存" },
  "bank-other": { label: "その他口座", description: "具体的な種別名を保存・再表示" },
  "bank-legacy": { label: "旧口座", description: "結合した銀行・支店と普通つき番号" },
  "bank-legacy-other": { label: "旧その他口座", description: "種別名と番号を結合した旧データ" },
};
const saved = new Map<string, BankStorage>();
const key = (c: { scenario: string; role: string }) => `${c.scenario}:${c.role}`;
export function getPreviewBank(c: { scenario: string; role: string; driver?: { companyCode: string } }): BankStorage | undefined {
  if (!(c.scenario in bankPreviewScenarios)) return undefined;
  if (c.driver) c.driver.companyCode = "TST";
  const legacy = c.scenario.startsWith("bank-legacy");
  const other = c.scenario.endsWith("other");
  return saved.get(key(c)) ?? { bank_name: legacy ? "見本銀行 中央支店" : "見本銀行", bank_no: legacy ? `${other ? "別段" : "普通"} 01234567` : "01234567", bank_holder: c.scenario === "bank-holder-half" ? "ﾐﾎﾝ ｶﾞｸ" : c.scenario === "bank-holder-full" ? "ミホン ガク" : "ミホン タロウ",
    bank_branch_name: legacy ? null : "中央支店", bank_account_type: legacy ? null : other ? "other" : "ordinary", bank_account_type_other: !legacy && other ? "別段" : null };
}
export const previewBankValues = (c: { scenario: string; role: string }) => { const row = getPreviewBank(c); return row ? bankAccountFromStorage(row) : undefined; };
export const savePreviewBank = (c: { scenario: string; role: string }, row: BankStorage) => { if (c.scenario in bankPreviewScenarios) saved.set(key(c), { ...row }); };
export const resetPreviewBank = (c: { scenario: string; role: string }) => { saved.delete(key(c)); };
