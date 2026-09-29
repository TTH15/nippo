import { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowRight, faCarSide, faCat, faChevronRight, faRoad, faSquareParking } from "@fortawesome/free-solid-svg-icons";
import { SceneSurface } from "./SceneReview";

type Idea = {
  id: string;
  title: string;
  line: string;
  detail: string;
  icon: typeof faCarSide;
  flow: [string, string, string];
  build: [string, string, string];
  scope: string;
};

const ideas: Idea[] = [
  {
    id: "drive", title: "公園をひと回り", line: "軽バンで、短い道を気ままに走る。",
    detail: "ベンチの風景をダブルタップすると、小さな公園へ。走るだけでも、止まって眺めるだけでもよい。点数や制限時間は置かない。",
    icon: faCarSide, flow: ["ベンチの風景をダブルタップ", "軽バンで小道を走る", "ベンチに戻るか、いつでも閉じる"],
    build: ["現在の車両モデルと公園シーンを別画面で再利用", "指の左右操作で車を曲げ、一定速度でゆっくり進める", "小道の端だけを判定し、背景化したら描画を止める"],
    scope: "最初の試作に向く。小さな一周コースだけで体験の手応えを測れる。",
  },
  {
    id: "discover", title: "まちの小さな発見", line: "見つけたものが、少しだけ反応する。",
    detail: "走っていると、ときどき猫や季節の草花が現れる。近づいてタップすると動くが、収集数や達成率は表示しない。",
    icon: faCat, flow: ["ゆっくり進む", "見つけた景色に近づく", "タップすると短い反応が返る"],
    build: ["出現位置を数か所に固定し、端末内で切り替える", "既存のタップ判定を車から見える位置へ拡張", "短いアニメーションと音・触覚を個別に調整"],
    scope: "ひと回りを作った後に足す。世界を増やす前に反応の質を磨く。",
  },
  {
    id: "parking", title: "一台だけの車庫入れ", line: "切り返しまで楽しめる、小さな操作遊び。",
    detail: "空いた枠へ軽バンをそっと停める。成功しても業務の記録や評価にはつなげず、何度でもやり直せる。",
    icon: faSquareParking, flow: ["小さな車庫を選ぶ", "前進・後退・ハンドルで切り返す", "枠に収まると静かに完了"],
    build: ["車体の向きと位置を固定時間刻みで更新", "壁と駐車枠に単純な当たり判定を置く", "戻す・やり直す操作を先に用意する"],
    scope: "操作の調整量が大きい。自由走行が気持ちよくなってから検討する。",
  },
];

const engines = [
  { name: "Three.js + Expo GL", fit: "最初の選択", description: "今のベンチと軽バンをそのまま使える。小さな道、タップ、簡単な車の動きまで同じ実装で進める。", tradeoff: "物理・地形・編集ツールは必要な分を自分たちで作る。" },
  { name: "Unity", fit: "規模が大きくなったら", description: "広い街、複雑な車の挙動、演出やステージ制作が中心になった段階で比較する。", tradeoff: "組み込みにはネイティブ開発と専用ビルドが必要。Expo Goでは試せず、iOS/Androidでは画面の一部だけに描画できない。" },
  { name: "Godot", fit: "別案として調査", description: "独立したゲームを作る道としては候補になる。", tradeoff: "現行アプリのiOS画面に組み込む経路は、現時点で先に検証が必要。" },
];

export function RestPlaygroundStudy() {
  const [selected, setSelected] = useState(ideas[0].id);
  const idea = ideas.find(item => item.id === selected)!;
  useEffect(() => { const previous = document.title; document.title = "休みの日の遊び構想｜ハコ虎"; return () => { document.title = previous; }; }, []);
  return <div className="rest-study">
    <style>{`
      .rest-study{--ink:#192333;--sub:#526074;--line:#D9E1E8;--paper:#F6F8FB;--amber:#FFD34E;--sage:#DCEAE0;color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Hiragino Kaku Gothic ProN","Noto Sans JP",sans-serif;padding:34px clamp(18px,4vw,52px) 90px;background:var(--paper)}
      .rest-study *{box-sizing:border-box}.rest-study button{cursor:pointer}.rest-study a{color:#28547D;text-decoration:underline;text-underline-offset:3px}.rest-study :is(button,a):focus-visible{outline:3px solid #2C6FA3;outline-offset:3px}
      .rest-container{max-width:1120px;margin:auto}.rest-back{display:inline-flex;align-items:center;gap:8px;font-size:13px;font-weight:650;margin-bottom:24px}
      .rest-hero{display:grid;grid-template-columns:minmax(0,1.08fr) minmax(320px,.92fr);gap:clamp(22px,4vw,52px);align-items:center}
      .rest-scene{height:420px;overflow:hidden;border-radius:26px;background:#DCEAE0;box-shadow:0 12px 38px #24344914;position:relative}.rest-scene-tag{position:absolute;left:18px;bottom:18px;background:#FFFFFFE8;color:var(--ink);padding:8px 12px;border-radius:10px;font-size:12px;font-weight:650;pointer-events:none}
      .rest-heading{font-size:clamp(34px,4.4vw,60px);line-height:1.19;letter-spacing:-.045em;margin:0 0 20px;font-weight:800}.rest-intro{font-size:16px;line-height:1.9;color:var(--sub);max-width:34em;margin:0 0 30px}.rest-pick{display:flex;align-items:center;gap:12px;font-size:14px;font-weight:700}.rest-pick .rest-pick-mark{width:43px;height:43px;background:var(--amber);border-radius:50%;display:grid;place-items:center}
      .rest-rule{border:0;border-top:1px solid var(--line);margin:55px 0 35px}.rest-section-head{display:flex;align-items:end;justify-content:space-between;gap:16px;margin-bottom:21px}.rest-section-head h2{font-size:24px;line-height:1.35;letter-spacing:-.025em;margin:0}.rest-section-head p{font-size:13px;color:var(--sub);margin:0}
      .rest-choices{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.rest-choice{border:1px solid var(--line);border-radius:17px;background:#fff;text-align:left;padding:18px 18px 20px;min-height:128px;display:flex;flex-direction:column;gap:11px;transition:border-color .15s,background .15s}.rest-choice[aria-pressed=true]{border-color:#C69818;background:#FFF8DE}.rest-choice-icon{font-size:19px;color:#596E7D}.rest-choice strong{font-size:18px}.rest-choice small{font-size:12px;line-height:1.5;color:var(--sub)}
      .rest-detail{background:#fff;border:1px solid var(--line);border-radius:22px;margin-top:14px;padding:clamp(23px,3.5vw,38px)}.rest-detail-top{display:grid;grid-template-columns:minmax(0,1fr) minmax(240px,.65fr);gap:32px;align-items:start}.rest-detail h3{font-size:clamp(25px,3vw,34px);margin:0 0 12px;letter-spacing:-.03em}.rest-detail p{font-size:14px;line-height:1.8;color:var(--sub);max-width:54ch;margin:0}.rest-scope{background:var(--sage);padding:17px 19px;border-radius:14px;font-size:13px;line-height:1.65;font-weight:650}
      .rest-detail-columns{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-top:33px;padding-top:27px;border-top:1px solid var(--line)}.rest-detail h4{font-size:14px;margin:0 0 13px}.rest-detail ol{list-style:none;padding:0;margin:0;display:grid;gap:12px}.rest-detail li{display:grid;grid-template-columns:25px 1fr;gap:11px;align-items:start;font-size:13px;line-height:1.6;color:#354457}.rest-detail li span{width:23px;height:23px;display:grid;place-items:center;background:#E7EDF3;border-radius:50%;font-size:11px;font-weight:750}
      .rest-architecture{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:0;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}.rest-architecture div{padding:19px 17px;border-right:1px solid var(--line)}.rest-architecture div:last-child{border-right:0}.rest-architecture strong{display:block;font-size:14px;margin-bottom:6px}.rest-architecture span{font-size:12px;line-height:1.6;color:var(--sub)}
      .rest-engine-table{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.rest-engine{border:1px solid var(--line);background:#fff;border-radius:17px;padding:19px;min-height:228px}.rest-engine:first-child{border-color:#C69818;box-shadow:inset 0 4px 0 var(--amber)}.rest-engine .fit{font-size:12px;color:#8F6412;font-weight:750}.rest-engine h3{font-size:19px;margin:9px 0 13px}.rest-engine p{font-size:13px;line-height:1.7;margin:0 0 10px}.rest-engine .trade{color:var(--sub)}.rest-sources{display:flex;flex-wrap:wrap;gap:8px 20px;font-size:12px;margin:18px 0 0;color:var(--sub)}
      .rest-conclusion{margin-top:45px;padding:25px 30px;border-radius:19px;background:#1F3043;color:#fff;display:flex;align-items:center;justify-content:space-between;gap:22px}.rest-conclusion strong{font-size:19px}.rest-conclusion p{font-size:13px;line-height:1.7;margin:7px 0 0;color:#D7E0E8}.rest-conclusion svg{flex:none;font-size:20px;color:var(--amber)}
      @media(max-width:800px){.rest-hero{grid-template-columns:1fr}.rest-scene{height:330px}.rest-section-head{align-items:start;flex-direction:column}.rest-detail-top{grid-template-columns:1fr}.rest-engine-table{grid-template-columns:1fr}.rest-engine{min-height:0}}
      @media(max-width:560px){.rest-study{padding:24px 16px 70px}.rest-hero{gap:28px}.rest-scene{height:320px}.rest-rule{margin:39px 0 29px}.rest-choices{grid-template-columns:1fr}.rest-choice{min-height:0;display:grid;grid-template-columns:27px 1fr;gap:4px 10px;padding:14px}.rest-choice-icon{grid-row:span 2}.rest-choice small{grid-column:2}.rest-detail-columns{grid-template-columns:1fr}.rest-architecture{grid-template-columns:1fr}.rest-architecture div{border-right:0;border-bottom:1px solid var(--line)}.rest-architecture div:last-child{border-bottom:0}.rest-conclusion{padding:22px}}
      @media(prefers-reduced-motion:reduce){.rest-choice{transition:none}}
    `}</style>
    <div className="rest-container">
      <a className="rest-back" href="?screen=home-design&board=ribbon&state=off&revision=rest-touch"><FontAwesomeIcon icon={faChevronRight} style={{ transform: "rotate(180deg)", width: 10 }} />休み画面へ戻る</a>
      <section className="rest-hero" aria-labelledby="rest-heading">
        <div className="rest-scene"><SceneSurface mode="off" /><span className="rest-scene-tag">いまの休み画面（操作可能）</span></div>
        <div><h1 id="rest-heading" className="rest-heading">休みの日に、<br />寄り道がある。</h1><p className="rest-intro">ベンチの風景から、軽バンで遊べる小さな世界へ。業務とは切り離し、入りたい人だけが入れる遊びを考えるページです。</p><div className="rest-pick"><span className="rest-pick-mark"><FontAwesomeIcon icon={faRoad} /></span>最初に作るなら「公園をひと回り」</div></div>
      </section>
      <hr className="rest-rule" />
      <section aria-labelledby="ideas-title"><div className="rest-section-head"><h2 id="ideas-title">三つの遊び方</h2><p>選ぶと体験と作り方が切り替わります</p></div>
        <div className="rest-choices" role="group" aria-label="遊び方を選ぶ">{ideas.map(item => <button type="button" className="rest-choice" key={item.id} aria-pressed={selected === item.id} onClick={() => setSelected(item.id)}><FontAwesomeIcon className="rest-choice-icon" icon={item.icon} /><strong>{item.title}</strong><small>{item.line}</small></button>)}</div>
        <div className="rest-detail" aria-live="polite"><div className="rest-detail-top"><div><h3>{idea.title}</h3><p>{idea.detail}</p></div><div className="rest-scope">{idea.scope}</div></div><div className="rest-detail-columns"><div><h4>遊ぶ流れ</h4><ol>{idea.flow.map((step, i) => <li key={step}><span>{i + 1}</span>{step}</li>)}</ol></div><div><h4>実装の核</h4><ol>{idea.build.map((step, i) => <li key={step}><span>{i + 1}</span>{step}</li>)}</ol></div></div></div>
      </section>
      <hr className="rest-rule" />
      <section aria-labelledby="build-title"><div className="rest-section-head"><h2 id="build-title">アプリに入れる順番</h2><p>現在の3Dを土台に、独立した遊び画面を足す</p></div><div className="rest-architecture"><div><strong>入口</strong><span>休みの風景をダブルタップ。単発タップの反応とは判定を分ける。</span></div><div><strong>遊ぶ画面</strong><span>全画面で車と公園を表示。戻る操作を常に見える場所へ。</span></div><div><strong>動き</strong><span>小道と簡単な当たり判定から。画面外では描画を停止。</span></div><div><strong>業務と分離</strong><span>GPS・シフト・報酬・実車の記録は読み書きしない。</span></div></div></section>
      <hr className="rest-rule" />
      <section aria-labelledby="engine-title"><div className="rest-section-head"><h2 id="engine-title">Unityは必要か</h2><p>最初は、すでに動いている仕組みを使う</p></div><div className="rest-engine-table">{engines.map(engine => <div className="rest-engine" key={engine.name}><span className="fit">{engine.fit}</span><h3>{engine.name}</h3><p>{engine.description}</p><p className="trade">{engine.tradeoff}</p></div>)}</div><p className="rest-sources">参照：<a href="https://docs.expo.dev/versions/latest/sdk/gl-view/" target="_blank" rel="noreferrer">Expo GL</a><a href="https://docs.expo.dev/workflow/customizing/" target="_blank" rel="noreferrer">Expoのネイティブコード</a><a href="https://docs.unity3d.com/ja/6000.0/Manual/UnityasaLibrary-iOS.html" target="_blank" rel="noreferrer">UnityのiOS組み込み</a><a href="https://docs.godotengine.org/en/4.6/about/faq.html" target="_blank" rel="noreferrer">Godotの組み込み状況</a></p></section>
      <div className="rest-conclusion"><div><strong>まずは30秒の小さなドライブを試作する</strong><p>触って気持ちよければ、猫や季節の変化を足す。広い街や複雑な物理が必要になった時点でエンジンを選び直す。</p></div><FontAwesomeIcon icon={faArrowRight} /></div>
    </div>
  </div>;
}
