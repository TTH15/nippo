import type { ComponentType } from "react";
import NotificationsPage from "@/app/(user)/notifications/page";
import RewardsPage from "@/app/(user)/me/rewards/page";
import { Nav } from "@/lib/components/Nav";
import { UserBottomNav } from "@/lib/components/UserBottomNav";
import { ScenarioBar } from "./kernel/AdminLayout";
import { HomeLoading } from "@/lib/components/HomeLoading";
import DriverRecordsPage from "@/app/(user)/me/records/page";
import PlatformLayout from "@/app/(platform)/platform/layout";
import PlatformPage from "@/app/(platform)/platform/page";
import PlatformApplicationsPage from "@/app/(platform)/platform/applications/page";
// 本番(user)/layoutのナビと本文枠を使い、ページ本体はそのまま描画する。
function DriverPage({ Page }: { Page: ComponentType }) {
  return <><div className="p-3"><ScenarioBar /></div><Nav variant="user" /><main className="user-main-with-bottom-nav"><Page /></main><UserBottomNav /></>;
}
export function DriverNotificationsPreview() { return <DriverPage Page={NotificationsPage} />; }
export function RewardsPreview() { return <DriverPage Page={RewardsPage} />; }
export function HomeLoadingPreview() { return <><div className="p-3"><ScenarioBar /></div><HomeLoading /></>; }
export function DriverRecordsPreview() { return <DriverPage Page={DriverRecordsPage} />; }
export function PlatformHomePreview() { return <><div className="p-3"><ScenarioBar /></div><PlatformLayout><PlatformPage /></PlatformLayout></>; }
export function PlatformApplicationsPreview() { return <><div className="p-3"><ScenarioBar /></div><PlatformLayout><PlatformApplicationsPage /></PlatformLayout></>; }
