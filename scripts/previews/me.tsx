import { MePageContent } from "@/app/(user)/me/page";
import { ScenarioBar } from "./kernel/AdminLayout";
export default function MePreview() {
  return <><div className="p-3"><ScenarioBar /></div><div className="mx-auto max-w-3xl p-4"><MePageContent /></div></>;
}
