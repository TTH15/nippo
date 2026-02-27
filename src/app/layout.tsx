import type { Metadata } from "next";
import "./globals.css";
import { getCompany } from "@/config/companies";

const company = getCompany(process.env.NEXT_PUBLIC_COMPANY_CODE);

export const metadata: Metadata = {
  title: company.title,
  description: company.description,
  icons: {
    icon: company.faviconPath,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=WDXL+Lubrifont+JP+N&family=Kaisei+Tokumin&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen">{children}</body>
    </html>
  );
}

