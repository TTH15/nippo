import { useState } from "react";
import minimal from "../../apps/mobile/src/capture/assets/meter-center-right-guide.png";
import contour from "../../apps/mobile/src/capture/assets/meter-center-right-option-2.png";
import labeled from "../../apps/mobile/src/capture/assets/meter-center-right-option-3.png";
import scaled from "../../apps/mobile/src/capture/assets/meter-center-right-option-4.png";
import detailed from "../../apps/mobile/src/capture/assets/meter-center-right-option-5.png";
import dualMinimal from "../../apps/mobile/src/capture/assets/meter-dual-center-fuel-guide.png";
import dualContour from "../../apps/mobile/src/capture/assets/meter-dual-center-fuel-option-2.png";
import dualLabeled from "../../apps/mobile/src/capture/assets/meter-dual-center-fuel-option-3.png";
import dualScaled from "../../apps/mobile/src/capture/assets/meter-dual-center-fuel-option-4.png";
import dualDetailed from "../../apps/mobile/src/capture/assets/meter-dual-center-fuel-option-5.png";
import sideMinimal from "../../apps/mobile/src/capture/assets/meter-center-side-guide.png";
import sideContour from "../../apps/mobile/src/capture/assets/meter-center-side-option-2.png";
import sideLabeled from "../../apps/mobile/src/capture/assets/meter-center-side-option-3.png";
import sideScaled from "../../apps/mobile/src/capture/assets/meter-center-side-option-4.png";
import sideDetailed from "../../apps/mobile/src/capture/assets/meter-center-side-option-5.png";
import digitalMinimal from "../../apps/mobile/src/capture/assets/meter-single-digital-guide.png";
import digitalContour from "../../apps/mobile/src/capture/assets/meter-single-digital-option-2.png";
import digitalLabeled from "../../apps/mobile/src/capture/assets/meter-single-digital-option-3.png";
import digitalScaled from "../../apps/mobile/src/capture/assets/meter-single-digital-option-4.png";
import digitalDetailed from "../../apps/mobile/src/capture/assets/meter-single-digital-option-5.png";
import tripleMinimal from "../../apps/mobile/src/capture/assets/meter-triple-center-guide.png";
import tripleContour from "../../apps/mobile/src/capture/assets/meter-triple-center-option-2.png";
import tripleLabeled from "../../apps/mobile/src/capture/assets/meter-triple-center-option-3.png";
import tripleScaled from "../../apps/mobile/src/capture/assets/meter-triple-center-option-4.png";
import tripleDetailed from "../../apps/mobile/src/capture/assets/meter-triple-center-option-5.png";

const names = ["1　基本形", "2　二重輪郭", "3　固定表記", "4　数字と目盛り", "5　細部まで"] as const;
const images = {
  every: [minimal, contour, labeled, scaled, detailed],
  acty: [dualMinimal, dualContour, dualLabeled, dualScaled, dualDetailed],
  minicab: [sideMinimal, sideContour, sideLabeled, sideScaled, sideDetailed],
  hijet: [digitalMinimal, digitalContour, digitalLabeled, digitalScaled, digitalDetailed],
  atrai: [tripleMinimal, tripleContour, tripleLabeled, tripleScaled, tripleDetailed],
} as const;
type Layout = keyof typeof images;

export function MeterGuideStudy() {
  const [layout, setLayout] = useState<Layout>(() => {
    const value = new URLSearchParams(location.search).get("layout");
    return value === "acty" || value === "minicab" || value === "hijet" || value === "atrai" ? value : "every";
  });
  const [selected, setSelected] = useState(3);
  const guides = names.map((name, index) => ({ name, image: images[layout][index] }));
  return <section style={{ padding: 16, maxWidth: 1280, margin: "0 auto", color: "#192333" }}>
    <style>{`@media(max-width:850px){.meter-guide-study-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important}}@media(max-width:480px){.meter-guide-study-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important}}`}</style>
    <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 6 }}>メーターガイドの描き込み</h1>
    <div role="group" aria-label="計器の配置" style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "16px 0 20px" }}>
      {([["every", "エブリイ参考"], ["acty", "アクティ参考"], ["minicab", "ミニキャブ参考"], ["hijet", "ハイゼット参考"], ["atrai", "アトレー参考"]] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={layout === value} onClick={() => { setLayout(value); setSelected(3); }} style={{ padding: "10px 16px", minHeight: 44, borderRadius: 12, border: "1px solid #CBD5E1", background: layout === value ? "#192333" : "white", color: layout === value ? "white" : "#192333" }}>{label}</button>)}
    </div>
    <div className="meter-guide-study-grid" role="group" aria-label="メーターガイドの描き込み" style={{ display: "grid", gridTemplateColumns: "repeat(5,minmax(0,1fr))", gap: 12 }}>
      {guides.map((guide, index) => <button key={guide.name} type="button" aria-pressed={selected === index} onClick={() => setSelected(index)} style={{ textAlign: "left", padding: 9, borderRadius: 12, background: "#20282F", border: selected === index ? "3px solid #FFC52C" : "3px solid transparent", color: "white", minWidth: 0 }}>
        <img alt="" src={guide.image} style={{ width: "100%", aspectRatio: "600 / 340", objectFit: "contain", display: "block" }} />
        <span style={{ display: "block", marginTop: 9, fontSize: 14, fontWeight: 600 }}>{guide.name}</span>
      </button>)}
    </div>
    <div aria-live="polite" style={{ margin: "24px auto 0", padding: 14, maxWidth: 780, background: "#20282F", borderRadius: 18, color: "white" }}>
      <p style={{ marginBottom: 8, fontWeight: 700 }}>{guides[selected].name}</p>
      <img alt={`${guides[selected].name}のメーター撮影ガイド`} src={guides[selected].image} style={{ width: "100%", display: "block" }} />
    </div>
  </section>;
}
