import { usePreviewRuntime, useStoreRevision } from "./kernel/runtime";
import { MePageContent } from "@/app/(user)/me/page";
import { Nav } from "@/lib/components/Nav";
import { UserBottomNav } from "@/lib/components/UserBottomNav";
import { ScenarioBar } from "./kernel/AdminLayout";
export default function MePreview() {
  const { store } = usePreviewRuntime();
  useStoreRevision(store);
  return <><div className="p-3"><ScenarioBar /></div><Nav variant="user" /><main className="user-main-with-bottom-nav"><MePageContent key={store.resetVersion} /></main><UserBottomNav /></>;
}
