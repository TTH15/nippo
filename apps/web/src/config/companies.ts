export type CompanyCode = "DEFAULT" | "ACE";

/** 請求書の請求元（自社）固定情報。売上請求書の請求元・受領請求書の請求先・振込先に使う。 */
export type InvoiceIssuer = {
  name: string;
  addressHtml: string;
  tel: string;
  regNo: string;
  bankName: string;
  bankNo: string;
  bankHolder: string;
  /** 印鑑画像のパス（public 配下）。空なら印鑑なし。 */
  stampPath: string;
};

export const companies = {
  DEFAULT: {
    code: "AAA",
    name: "Nippo",
    logoPath: "/logo/Nippo.svg",
    faviconPath: "/logo/favicon.svg",
    title: "Nippo | 配送日報集計システム",
    description: "配送日報集計システム",
    invoiceIssuer: {
      name: "",
      addressHtml: "",
      tel: "",
      regNo: "",
      bankName: "",
      bankNo: "",
      bankHolder: "",
      stampPath: "",
    } as InvoiceIssuer,
  },
  ACE: {
    code: "ACE",
    name: "株式会社ACE CREATION",
    logoPath: "/logo/Nippo.svg",
    faviconPath: "/logo/favicon.svg",
    title: "Nippo | 配送日報集計システム",
    description: "配送日報集計システム（ACE CREATION）",
    invoiceIssuer: {
      name: "株式会社ACE CREATION",
      addressHtml: "〒615-0904<br/>京都市右京区梅津堤上町21 KKハウスⅡ 101",
      tel: "080-9540-4451",
      regNo: "T6130001080238",
      bankName: "京都信用金庫 梅津支店",
      bankNo: "普通 3058832",
      bankHolder: "口座名義：カ)ｴｰｽｸﾘｴｲｼｮﾝ",
      stampPath: "/invoice/ACE_CREATION_stamp_1.png",
    } as InvoiceIssuer,
  },
} as const;

export function getCompany(activeCode?: string) {
  const code = (activeCode as CompanyCode) || "DEFAULT";
  return companies[code] ?? companies.DEFAULT;
}

/**
 * アクティブ会社の請求元（自社）固定情報。既定は環境変数 NEXT_PUBLIC_COMPANY_CODE。
 * 未設定（DEFAULT 等で issuer 未登録）の場合は、現行運用に合わせて ACE をフォールバック。
 */
export function getInvoiceIssuer(activeCode: string | undefined = process.env.NEXT_PUBLIC_COMPANY_CODE): InvoiceIssuer {
  const issuer = getCompany(activeCode).invoiceIssuer;
  return issuer && issuer.name ? issuer : companies.ACE.invoiceIssuer;
}

