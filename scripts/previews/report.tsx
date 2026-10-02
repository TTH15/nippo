import { MePageContent } from "@/app/(user)/me/page";
import { Nav } from "@/lib/components/Nav";
import { UserBottomNav } from "@/lib/components/UserBottomNav";
import { ScenarioBar } from "./kernel/AdminLayout";
// 本番 /report と (user)/layout のUIを直接再利用。
export default function ReportPreview() {
  return <><div className="p-3"><ScenarioBar /></div><Nav variant="user" />
    <main className="user-main-with-bottom-nav"><MePageContent forceReport /></main><UserBottomNav /></>;
}
