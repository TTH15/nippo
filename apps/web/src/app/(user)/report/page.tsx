import { Suspense } from "react";
import { MePageContent } from "../me/page";

// 諸報告（オイル交換・修理・経費など）の独立ページ。
// 下部ナビの「報告」アイコン＝このページ（1アイコン=1ページ）。
export default function ReportPage() {
  return (
    <Suspense fallback={null}>
      <MePageContent forceReport />
    </Suspense>
  );
}
