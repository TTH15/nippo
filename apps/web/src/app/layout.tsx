import type { Metadata, Viewport } from "next";
import "./globals.css";
import { getCompany } from "@/config/companies";
import { ServiceWorkerRegister } from "@/lib/components/ServiceWorkerRegister";
import { ModeTransitionProvider } from "@/lib/components/ModeTransition";

const company = getCompany(process.env.NEXT_PUBLIC_COMPANY_CODE);

export const metadata: Metadata = {
  title: company.title,
  description: company.description,
  manifest: "/manifest.webmanifest",
  icons: {
    icon: company.faviconPath,
    apple: "/logo/icon-192.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: company.title,
  },
};

export const viewport: Viewport = {
  themeColor: "#0f2a52",
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <head>
        <meta name="mobile-web-app-capable" content="yes" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=WDXL+Lubrifont+JP+N&family=Kaisei+Tokumin&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen">
        <ServiceWorkerRegister />
        {/* モード切替のインク演出はルートグループをまたいで表示し続ける必要が
            あるため、(admin)/(user) ではなくルートに置く */}
        <ModeTransitionProvider>{children}</ModeTransitionProvider>
      </body>
    </html>
  );
}

