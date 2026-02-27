export type CompanyCode = "DEFAULT" | "ACE";

export const companies = {
  DEFAULT: {
    code: "AAA",
    name: "Niipo",
    logoPath: "/logo/Niipo.svg",
    faviconPath: "/logo/favicon.svg",
    title: "Nippo | 配送日報集計システム",
    description: "配送日報集計システム",
  },
  ACE: {
    code: "ACE",
    name: "株式会社ACE CREATION",
    logoPath: "/logo/Niipo.svg",
    faviconPath: "/logo/favicon.svg",
    title: "Nippo | 配送日報集計システム",
    description: "配送日報集計システム（ACE CREATION）",
  },
} as const;

export function getCompany(activeCode?: string) {
  const code = (activeCode as CompanyCode) || "DEFAULT";
  return companies[code] ?? companies.DEFAULT;
}

