// 本番ログイン画面をそのまま使い、プレビューのシナリオバーだけ外側に付ける。
import LoginPage from "@/app/login/page";
import { ScenarioBar } from "./kernel/AdminLayout";

export default function LoginPreview() {
  return <><div className="p-3"><ScenarioBar /></div><LoginPage /></>;
}
