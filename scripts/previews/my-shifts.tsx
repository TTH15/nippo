import ShiftsPage from "@/app/(user)/shifts/page";
import { Nav } from "@/lib/components/Nav";
import { UserBottomNav } from "@/lib/components/UserBottomNav";
import { ScenarioBar } from "./kernel/AdminLayout";

// (user)/layout のナビ・本文幅を再利用。PCでも監査用に本文を表示する。
export default function MyShiftsPreview() {
  return <><div className="p-3"><ScenarioBar /></div>
    <div className="min-h-screen bg-[var(--color-bg)]">
      <Nav variant="user" />
      <main className="user-main-with-bottom-nav"><ShiftsPage /></main>
      <UserBottomNav />
    </div>
  </>;
}
