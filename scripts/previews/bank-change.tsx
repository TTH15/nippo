import BankChangePageContent from "@/app/account/bank-change/page";
import { ScenarioBar } from "./kernel/AdminLayout";
import { usePreviewRuntime, useStoreRevision } from "./kernel/runtime";
export default function BankChangePreview() {
  const { store } = usePreviewRuntime(); useStoreRevision(store);
  return <><div className="p-3"><ScenarioBar /></div><BankChangePageContent key={store.resetVersion} /></>;
}
