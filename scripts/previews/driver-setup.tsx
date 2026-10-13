import { usePreviewRuntime, useStoreRevision } from "./kernel/runtime";
import { DriverSetupGate } from "@/lib/components/DriverSetupGate";
import { MePageContent } from "@/app/(user)/me/page";
import { Nav } from "@/lib/components/Nav";
import { UserBottomNav } from "@/lib/components/UserBottomNav";
import { ScenarioBar } from "./kernel/AdminLayout";
// 本番のゲート・マイページ・ナビを再利用し、PCでも監査用に本文を表示する。
export default function DriverSetupPreview() {
  const { store } = usePreviewRuntime();
  useStoreRevision(store);
  return <><div className="p-3"><ScenarioBar /></div><DriverSetupGate key={store.resetVersion}>
    <Nav variant="user" /><main className="user-main-with-bottom-nav"><MePageContent /></main><UserBottomNav />
  </DriverSetupGate></>;
}
