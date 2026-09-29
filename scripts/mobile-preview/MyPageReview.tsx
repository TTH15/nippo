import { useEffect, useState } from "react";
import { AuthContext } from "../../apps/mobile/src/AuthContext";
import { MeScreen } from "../../apps/mobile/src/screens/MeScreen";
import { accountSectionTitles, type AccountSection } from "../../apps/mobile/src/components/MyPageMenu";
import { setAccountScenario, type AccountScenario } from "../../apps/mobile/ui-preview/account-fixture";
const driver = { id: "preview-driver", name: "サンプル 太郎", role: "DRIVER", capabilities: [] };
export function MyPageReview({ onAppSettings, onDirtyChange }: { onAppSettings: () => void; onDirtyChange: (dirty: boolean) => void }) {
  const [section, setSection] = useState<AccountSection | "home">("home");
  const [revision, setRevision] = useState(0);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false); }, [dirty, onDirtyChange]);
  const [message, setMessage] = useState("");
  return <AuthContext.Provider value={{ driver, logout: () => setMessage("ログアウトしました（画面確認）") }}>
    {section !== "home" && <div style={{ marginBottom: 16 }}><button aria-label="マイページへ戻る" onClick={() => { if (!dirty || window.confirm("振込口座の変更を破棄して戻りますか？")) setSection("home"); }} style={{ minHeight: 44 }}>マイページへ戻る</button><h3 style={{ fontSize: 23, fontWeight: 700 }}>{accountSectionTitles[section]}</h3></div>}
    <div style={{ margin: "0 -16px" }}><MeScreen key={`${section}-${revision}`} section={section} onOpen={setSection} onAppSettings={onAppSettings} onUnsavedChange={setDirty} /></div>
    {message && <p role="status">{message}</p>}
    <details style={{ marginTop: 32, fontSize: 12 }}><summary>画面確認</summary><div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{([['normal', '登録済み'], ['missing', '口座未登録'], ['error', '取得失敗'], ['loading', '読込中']] as [AccountScenario, string][]).map(([value, label]) => <button key={value} style={{ minHeight: 44, padding: 8 }} onClick={() => { setAccountScenario(value); setRevision(v => v + 1); }}>{label}</button>)}</div></details>
  </AuthContext.Provider>;
}
