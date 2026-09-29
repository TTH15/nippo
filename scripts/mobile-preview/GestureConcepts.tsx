import { useState } from "react";
import van from "../../docs/design/assets/mobile-home-3d-2026-09/gesture-concepts/01-mini-van.png";
import glass from "../../docs/design/assets/mobile-home-3d-2026-09/gesture-concepts/02-glass-ribbon.png";
import ticket from "../../docs/design/assets/mobile-home-3d-2026-09/gesture-concepts/03-dispatch-ticket.png";
import shutter from "../../docs/design/assets/mobile-home-3d-2026-09/gesture-concepts/04-shutter.png";
import lights from "../../docs/design/assets/mobile-home-3d-2026-09/gesture-concepts/05-headlights.png";
import springs from "../../docs/design/assets/mobile-home-3d-2026-09/gesture-concepts/06-suspension.png";

const ideas = [
  { title: "01 ミニバン・スライド", src: van, motion: "小さな軽バンを右へ運び、端で離すとQRの読み取りへ。", kind: "横スライド" },
  { title: "02 ガラスのリボン", src: glass, motion: "指に合わせて帯が伸び、離すと滑らかに収まる。", kind: "横スライド" },
  { title: "03 出発チケット", src: ticket, motion: "配車票のタブを引き出し、QRの読み取り画面を開く。", kind: "横スライド" },
  { title: "04 シャッター", src: shutter, motion: "取っ手を短く上へ動かすと、その奥からカメラが現れる。", kind: "上スワイプ" },
  { title: "05 ヘッドライト", src: lights, motion: "押している間にライトがふわっと灯り、QRの読み取りへ。", kind: "長押し" },
  { title: "06 サスペンション", src: springs, motion: "押すと車体が少し沈み、完了時に一度だけ軽く戻る。", kind: "長押し" },
];
export function GestureConcepts() {
  const [selected, setSelected] = useState(0);
  const idea = ideas[selected];
  return <div className="space-y-4">
    <p className="text-sm text-brand-500">画像による操作案です。動きは未実装で、画像内の文言・タブ・車種の細部は採用内容ではありません。</p>
    <div className="flex flex-wrap gap-2" role="group" aria-label="楽しくなる操作の6案">
      {ideas.map((item, i) => <button key={item.title} aria-pressed={selected === i} onClick={() => setSelected(i)} style={{ minHeight: 44, padding: "10px 14px", borderRadius: 12, border: "1px solid #CBD5E1", background: selected === i ? "#192333" : "white", color: selected === i ? "white" : "#192333" }}>{item.title}</button>)}
    </div>
    <figure><figcaption className="mb-3"><h2 className="text-xl font-bold">{idea.title}</h2><p className="text-sm text-brand-500 mt-2">{idea.kind}：{idea.motion}</p></figcaption>
      <img src={idea.src} alt={`${idea.title}：触れる前・操作中・撮影へ進む状態の比較`} width={1536} height={1024} style={{ width: "100%", height: "auto", borderRadius: 18 }} />
    </figure>
  </div>;
}
