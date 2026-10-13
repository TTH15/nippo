import { useState } from "react";

// DriverSetupGate / MePageContent / Navをそのまま隔離iframeで比較する。
// 各iframeのSMS・保存は既存fixtureだけを使用し、実サービスに接続しない。
export default function DriverSetupDesigns() {
  const [revision, setRevision] = useState(0);
  const designs = [
    { id: "a", title: "A 下線・コンパクト", description: "推奨案。大きな文字と下線。外枠を480pxに縮める。" },
    { id: "b", title: "B 薄い背景の入力欄", description: "枠線を使わず、淡い面で入力場所を示す。" },
    { id: "c", title: "C コード入力に集中", description: "送信後は電話番号欄を畳み、コードを大きく表示。外枠448px。" },
  ];
  return <main style={{ padding: "24px 16px", background: "#f1f5f9", minHeight: "100vh", color: "#0f172a" }}>
    <div style={{ maxWidth: 1320, margin: "0 auto" }}>
      <h1 style={{ fontSize: 22, fontWeight: 700 }}>利用開始の準備 — 3案比較</h1>
      <p style={{ fontSize: 14, margin: "8px 0 12px", color: "#475569" }}>各案で電話番号を入力して「認証コードを送信」を押すと、コード入力を比較できます。架空コードは123456。</p>
      <button onClick={() => setRevision(revision + 1)} style={{ minHeight: 44, padding: "8px 16px", border: "1px solid #cbd5e1", borderRadius: 8, background: "white", fontSize: 14 }}>3案を初期化</button>
      <div className="setup-design-grid" style={{ marginTop: 20, display: "grid", gap: 16 }}>
        {designs.map(design => <section key={design.id} style={{ minWidth: 0 }}>
          <h2 style={{ fontSize: 17, fontWeight: 700 }}>{design.title}</h2>
          <p style={{ fontSize: 13, color: "#475569", minHeight: 44, margin: "6px 0 12px" }}>{design.description}</p>
          <iframe key={`${design.id}-${revision}`} title={design.title} src={`/preview/admin/driver-setup?scenario=no-phone&design=${design.id}`} style={{ width: "100%", height: 640, border: "1px solid #cbd5e1", borderRadius: 12, background: "white" }} />
        </section>)}
      </div>
      <style>{`.setup-design-grid {grid-template-columns:repeat(3,minmax(0,1fr));} @media(max-width:1000px){.setup-design-grid {grid-template-columns:1fr;} .setup-design-grid section {max-width:440px; width:100%; margin:0 auto;}}`}</style>
    </div>
  </main>;
}
