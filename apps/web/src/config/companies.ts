export type CompanyCode = "DEFAULT" | "ACE";

export const companies = {
  DEFAULT: {
    code: "AAA",
    name: "ハコ虎",
    logoPath: "/logo/Nippo.svg",
    faviconPath: "/logo/favicon.svg",
    title: "ハコ虎 | 現場の全てを、一つに。",
    description: "物流現場のデータを積み重ねるプラットフォーム",
  },
  ACE: {
    code: "ACE",
    name: "株式会社ACE CREATION",
    logoPath: "/logo/Nippo.svg",
    faviconPath: "/logo/favicon.svg",
    title: "ハコ虎 | 現場の全てを、一つに。",
    description: "物流現場のデータを積み重ねるプラットフォーム（ACE CREATION）",
  },
} as const;

export function getCompany(activeCode?: string) {
  const code = (activeCode as CompanyCode) || "DEFAULT";
  return companies[code] ?? companies.DEFAULT;
}

