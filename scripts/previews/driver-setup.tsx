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
  const design = new URLSearchParams(window.location.search).get("design");
  // 比較案の装飾だけを隔離runner内で上書きする。本番の入力・SMS・遷移を共用する。
  const common = ` [role=dialog] { height:min(30rem,85svh); max-width:420px; } [role=dialog] input { height:56px; font-size:24px; line-height:32px; } [role=dialog] input[aria-label="認証コード"] { letter-spacing:.25em; } [role=dialog] > div:first-child {margin-bottom:8px;} [role=dialog] section {padding-top:0; padding-bottom:0;} [role=dialog] section > div:first-child {margin-bottom:8px;} [role=dialog] .space-y-2 > * + * {margin-top:4px;} [role=dialog] .space-y-3 > * + * {margin-top:8px;} [role=dialog] .mt-4 {margin-top:12px;} `;
  const variants: Record<string, string> = {
    a: common,
    b: common + ` [role=dialog] input { background:#f1f5f9; border-bottom-color:transparent; border-radius:8px; padding:8px 14px; } [role=dialog] input:focus { border-bottom-color:#0f172a; } [role=dialog] section { padding-top:4px; padding-bottom:4px; } `,
    c: common + ` [role=dialog] {height:min(28rem,85svh);} [role=dialog] input {height:60px; font-size:28px;} [role=dialog] label:has(input[type=tel]:disabled) {display:none;} [role=dialog] input[aria-label="認証コード"] {font-size:32px; letter-spacing:.3em;} `,
  };
  return <>{design && variants[design] && <style>{variants[design]}</style>}{!design && <div className="p-3"><ScenarioBar /></div>}<DriverSetupGate key={store.resetVersion}>
    <Nav variant="user" /><main className="user-main-with-bottom-nav"><MePageContent /></main><UserBottomNav />
  </DriverSetupGate></>;
}
