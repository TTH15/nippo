import { useState } from "react";
import light from "../../docs/design/assets/mobile-home-3d-2026-09/home-states-v1.png";
import dark from "../../docs/design/assets/mobile-home-3d-2026-09/home-states-dark-v1.png";
import scenery from "../../docs/design/assets/mobile-home-3d-2026-09/scenery-kit-v1.png";
import modal from "../../docs/design/assets/mobile-home-3d-2026-09/session-modal-v2.png";
import { GestureConcepts } from "./GestureConcepts";
import { GestureReview } from "./GestureReview";
import { SceneReview } from "./SceneReview";
import { SessionShellReview } from "./SessionShellReview";
import nativeHome from "../../docs/design/assets/mobile-home-3d-2026-09/ribbon-feedback/home.png";
import nativeSheet from "../../docs/design/assets/mobile-home-3d-2026-09/ribbon-feedback/working.png";
import nativeStretch from "../../docs/design/assets/mobile-home-3d-2026-09/ribbon-feedback/stretch.png";
import nativeCamera from "../../docs/design/assets/mobile-home-3d-2026-09/capture-actions/native-vehicle.png";
import nativeBlur from "../../docs/design/assets/mobile-home-3d-2026-09/native-ribbon/blur.png";
import nativeSettings from "../../docs/design/assets/mobile-home-3d-2026-09/ribbon-feedback/settings.png";
import nativeMini from "../../docs/design/assets/mobile-home-3d-2026-09/native/shift-mini.png";

// WorkScreen / PunchButtonの現行フローを参照した画像レビュー。業務操作は実装しない。
const boards = [
  { key: "modal", label: "タブ・モーダル案", src: modal, alt: "通常ホーム、タブ上の稼働中ミニバー、下から開く稼働中モーダル" },
  { key: "light", label: "ライト案", src: light, alt: "稼働前・稼働中・休みのライト案" },
  { key: "dark", label: "ダーク案", src: dark, alt: "同じ3状態のダーク案。後続実装の検討用" },
  { key: "scenery", label: "背景素材", src: scenery, alt: "極低ポリの木・建物・雲・道路・ベンチの制作参考" },
];

export function HomeDesignReview() {
  const [boardKey, setBoardKey] = useState(() => ["native", "scene", "shell", "gestures", "gesture-concepts", "ribbon"].includes(new URLSearchParams(window.location.search).get("board") ?? "") ? new URLSearchParams(window.location.search).get("board")! : "modal");
  const [panel, setPanel] = useState(0);
  const board = boards.find(item => item.key === boardKey)!;
  const crop = boardKey !== "scenery" && panel > 0;
  const buttonStyle = (selected: boolean) => ({
    padding: "10px 16px", borderRadius: 12, border: "1px solid #CBD5E1",
    background: selected ? "#192333" : "white", color: selected ? "white" : "#192333",
    fontSize: 14, minHeight: 44,
  });
  return <section className="p-4 space-y-4">
    <div>
      <h1 className="text-2xl font-bold">ハコ虎 ホームの画面案</h1>
      <p className="text-sm text-brand-500 mt-2">{["native", "scene", "shell", "gestures", "gesture-concepts", "ribbon"].includes(boardKey) ? "架空データの隔離プレビュー" : "生成画像の画面案。画像内のボタンは操作できません。"}</p>
    </div>
    <div className="flex flex-wrap gap-2" role="group" aria-label="画面案">
      {boards.map(item => <button key={item.key} aria-pressed={boardKey === item.key}
        style={buttonStyle(boardKey === item.key)} onClick={() => setBoardKey(item.key)}>{item.label}</button>)}
      <button aria-pressed={boardKey === "ribbon"} style={buttonStyle(boardKey === "ribbon")} onClick={() => setBoardKey("ribbon")}>リボンを試す</button>
      <button aria-pressed={boardKey === "gesture-concepts"} style={buttonStyle(boardKey === "gesture-concepts")} onClick={() => setBoardKey("gesture-concepts")}>楽しくなる操作の6案</button>
      <button aria-pressed={boardKey === "gestures"} style={buttonStyle(boardKey === "gestures")} onClick={() => setBoardKey("gestures")}>開始・終了の操作を比べる</button>
      <button aria-pressed={boardKey === "shell"} style={buttonStyle(boardKey === "shell")} onClick={() => setBoardKey("shell")}>タブとモーダルを試す</button>
      <button aria-pressed={boardKey === "scene"} style={buttonStyle(boardKey === "scene")} onClick={() => setBoardKey("scene")}>3Dを試す</button>
      <button aria-pressed={boardKey === "native"} style={buttonStyle(boardKey === "native")} onClick={() => setBoardKey("native")}>iOSの試作</button>
    </div>
    {boardKey !== "ribbon" && boardKey !== "gesture-concepts" && boardKey !== "gestures" && boardKey !== "scenery" && boardKey !== "shell" && boardKey !== "native" && boardKey !== "scene" && <div className="flex flex-wrap gap-2" role="group" aria-label="表示する状態">
      {(boardKey === "modal" ? ["全体", "通常ホーム", "ミニバー", "モーダル"] : ["全体", "稼働前", "稼働中", "休み"]).map((label, index) => <button key={label}
        aria-pressed={panel === index} style={buttonStyle(panel === index)} onClick={() => setPanel(index)}>{label}</button>)}
    </div>}
    {boardKey === "ribbon" ? <SessionShellReview key="ribbon" ribbon /> : boardKey === "gesture-concepts" ? <GestureConcepts /> : boardKey === "gestures" ? <GestureReview /> : boardKey === "scene" ? <SceneReview /> : boardKey === "native" ? <div className="space-y-4">
      <p className="text-sm text-brand-500">iOSシミュレーターの実装キャプチャ。ホーム・リボン・撮影・設定は実装済み、ミニバー画像は以前の記録です。振動の強さと終了スライドはiPhoneで再確認中。撮影・品質判定・保存は架空です。</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))", gap: 20 }}>
        {[["通常ホーム", nativeHome], ["伸びるリボン", nativeStretch], ["車両の撮影", nativeCamera], ["再撮影の案内（以前の記録）", nativeBlur], ["別タブと稼働ミニバー（以前の記録）", nativeMini], ["稼働中モーダル", nativeSheet], ["振動の設定", nativeSettings]].map(([title, src]) => <figure key={title}>
          <figcaption className="font-bold mb-3">{title}</figcaption><img src={src} alt={`${title}のiOS実装キャプチャ`} style={{ width: "100%", height: "auto", borderRadius: 18 }} />
        </figure>)}
      </div>
    </div> : boardKey === "shell" ? <SessionShellReview key="shell" /> : <figure style={{ maxWidth: crop ? 480 : 1280, margin: "0 auto" }}>
      <div style={{ overflow: "hidden", borderRadius: 16, background: "#EDF1F5" }}>
        <img src={board.src} alt={board.alt} width={1536} height={1024} style={{
          display: "block", width: crop ? "300%" : "100%", maxWidth: "none", height: "auto",
          marginLeft: crop ? `${-(panel - 1) * 100}%` : 0,
        }} />
      </div>
      <figcaption className="text-sm text-brand-500 mt-3">
        {boardKey === "modal" ? "通常は下部タブ。稼働中モーダルを閉じても、稼働は続きます。"
          : boardKey === "dark" ? "ダークは色と照明の参考です。タブ構造は最新のモーダル案を優先します。"
          : boardKey === "scenery" ? "形状と色の制作参考です。新規3Dモデルは未制作です。"
          : "初版の色・車・休みの参考です。タブ構造は最新のモーダル案を優先します。"}
      </figcaption>
    </figure>}
  </section>;
}
