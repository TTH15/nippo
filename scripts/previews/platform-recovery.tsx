// 本番のプラットフォーム外枠と復旧ページをそのまま使う。APIはfixtureへ隔離。
import PlatformLayout from "@/app/(platform)/platform/layout";
import Page from "@/app/(platform)/platform/account-recovery/page";
import { ScenarioBar } from "./kernel/AdminLayout";
export default function PlatformRecoveryPreview() {
  return <><div className="p-3"><ScenarioBar /></div><PlatformLayout><Page /></PlatformLayout></>;
}
