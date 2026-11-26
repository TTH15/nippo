import SubmitPage from "@/app/(user)/submit/SubmitPageClientV2";
import { Nav } from "@/lib/components/Nav";
import { UserBottomNav } from "@/lib/components/UserBottomNav";
import { ModeSwitchFab } from "@/lib/components/ModeSwitchFab";
import { ModeTransitionProvider } from "@/lib/components/ModeTransition";
import { usePreviewRuntime } from "./kernel/runtime";
import { ScenarioBar } from "./kernel/AdminLayout";

// (user)/layout のナビ・本文幅を再利用。PCでも監査用に本文を表示する。
export default function SubmitPreview() {
  const { store } = usePreviewRuntime();
  return <ModeTransitionProvider>
    <style>{".submit-preview-tools:has(+ .driver-shell :is(.parking-page, [data-report-stage])) { display: none; }"}</style>
    {store.scenario !== "parking-device" && <div className="submit-preview-tools p-3"><ScenarioBar /></div>}
    <div className="driver-shell flex min-h-screen flex-col bg-[var(--color-bg)]">
      <Nav variant="user" />
      <main className="user-main-with-bottom-nav flex-1"><SubmitPage /><ModeSwitchFab mode="driver" /></main>
      <UserBottomNav />
    </div>
  </ModeTransitionProvider>;
}
