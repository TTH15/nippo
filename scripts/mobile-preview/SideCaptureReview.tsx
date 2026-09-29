import { useEffect, useRef, useState, type ReactNode } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faMobileScreenButton, faRotateRight } from "@fortawesome/free-solid-svg-icons";
import side from "../../apps/mobile/src/capture/assets/van-side.png";
import type { CaptureRotation } from "../../apps/mobile/src/capture/orientation";
import { CaptureActions } from "./CaptureActions";
// Native SideCaptureOverlayの配置を複製。回転ボタンは端末センサーの代わり。
export function SideCaptureReview({ angle, shot, warning, controls, onShot, onRetake, onConfirm, onCancel }: {
  angle: "left" | "right"; shot: boolean; warning: string | null; controls: ReactNode;
  onShot: () => void; onRetake: () => void; onConfirm: () => void; onCancel: () => void;
}) {
  const [rotation, setRotation] = useState<CaptureRotation>(null);
  const root = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const prompt = useRef<HTMLDivElement>(null), phone = useRef<HTMLDivElement>(null);
  useEffect(() => { const element = root.current!; const update = () => setSize({ width: element.clientWidth, height: element.clientHeight }); const observer = new ResizeObserver(update); observer.observe(element); update(); return () => observer.disconnect(); }, []);
  useEffect(() => {
    if (rotation) return;
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    let animation: Animation | undefined;
    const update = () => { animation?.cancel(); if (!media.matches && !document.hidden) animation = phone.current?.animate([{ transform: "rotate(0deg)", offset: 0 }, { transform: "rotate(0deg)", offset: .2 }, { transform: "rotate(90deg)", offset: .55 }, { transform: "rotate(90deg)", offset: .8 }, { transform: "rotate(0deg)" }], { duration: 2250, iterations: Infinity }); };
    update(); media.addEventListener("change", update); document.addEventListener("visibilitychange", update);
    return () => { animation?.cancel(); media.removeEventListener("change", update); document.removeEventListener("visibilitychange", update); };
  }, [rotation]);
  const title = `車両の${angle === "right" ? "右" : "左"}`;
  const cancel = <button onClick={onCancel} style={{ minHeight: 44, color: "#D1D6DC", fontSize: 14 }}>やめる</button>;
  return <div ref={root} data-testid="side-capture" role="dialog" aria-modal="true" aria-label={`${title}の撮影`} style={{ position: "absolute", inset: 0, background: "#21292F", color: "white" }}>
    {!rotation ? <div ref={prompt} data-testid="capture-turn-prompt" style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "space-between", padding: 24, background: "#08090BEE" }}>
      <h2 style={{ fontSize: 23, fontWeight: 700 }}>{title}</h2>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 24 }}><div aria-hidden="true" style={{ width: 160, height: 150, display: "grid", placeItems: "center", position: "relative" }}><div ref={phone}><FontAwesomeIcon icon={faMobileScreenButton} style={{ fontSize: 90, color: "#FFD45C" }} /></div><FontAwesomeIcon icon={faRotateRight} style={{ position: "absolute", right: 0, top: 12, fontSize: 27, color: "#FFD45C" }} /></div><p role="alert" style={{ fontWeight: 700, fontSize: 23 }}>スマホを横向きに</p><img src={side} alt="横長の車両ガイド" style={{ width: 220, height: 100, objectFit: "contain", transform: `scaleX(${angle === "right" ? -1 : 1})` }} /></div>
      <div style={{ width: "100%", display: "grid", gap: 10 }}><div style={{ display: "flex", justifyContent: "center", gap: 12 }}>{([90, -90] as const).map(value => <button key={value} onClick={() => setRotation(value)} style={{ minHeight: 44, color: "#87909B", fontSize: 11 }}>確認用：{value === 90 ? "左" : "右"}へ回転</button>)}</div>{cancel}</div>
    </div> : <div data-testid="capture-landscape" style={{ position: "absolute", width: size.height, height: size.width, left: (size.width - size.height) / 2, top: (size.height - size.width) / 2, transform: `rotate(${rotation}deg)`, padding: "16px 24px", background: shot ? "#08090B" : "#0004", display: "flex", gap: 16 }}>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}><h2 style={{ fontSize: 19, fontWeight: 700 }}>{title}</h2><div data-testid="side-viewfinder" style={{ flex: 1, minHeight: 0, overflow: "hidden" }}><img alt={`${title}の撮影ガイド`} src={side} style={{ width: "100%", height: "100%", objectFit: "contain", transform: `scaleX(${angle === "right" ? -1 : 1})`, opacity: shot ? .55 : 1 }} /></div>{warning && <p role="alert" style={{ fontSize: 13, color: "#FFE08B" }}>{warning}</p>}
      {shot && <CaptureActions onRetake={onRetake} onConfirm={onConfirm} confirmLabel={warning ? "この写真で続ける" : "この写真を使う"} />}
      {!shot && <button style={{ color: "#87909B", fontSize: 11, minHeight: 32, alignSelf: "start" }} onClick={() => setRotation(null)}>確認用：縦向きに戻す</button>}</div>
      <div style={{ width: 104, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "space-between" }}><div>{!shot && controls}</div>{!shot && <button data-testid="capture-shutter" aria-label="写真を撮影" onClick={onShot} style={{ width: 76, height: 76, flexShrink: 0, borderRadius: "50%", border: "3px solid white", padding: 4 }}><span style={{ display: "block", width: "100%", height: "100%", borderRadius: "50%", background: "white" }} /></button>}{cancel}</div>
    </div>}
  </div>;
}
