import { useEffect, useRef, useState } from "react";
import * as T from "three";
import vanPoster from "../../apps/mobile/ui-preview/scene/assets/van-poster.png";
import offPoster from "../../apps/mobile/ui-preview/scene/assets/off-poster.png";
import vanDarkPoster from "../../apps/mobile/ui-preview/scene/assets/van-dark-poster.png";
import offDarkPoster from "../../apps/mobile/ui-preview/scene/assets/off-dark-poster.png";
import { createDrivingScene, type SceneMode } from "../../apps/mobile/ui-preview/scene/create-scene";
import { createFrameLoop } from "../../apps/mobile/ui-preview/scene/frame-loop";

import sessionPoster from "../../apps/mobile/ui-preview/scene/assets/session-poster.png";
export function SceneSurface({ mode, dark = false, paused = false, failure = false, immersive = false, rear = false, onStats }: {
  mode: SceneMode; dark?: boolean; paused?: boolean; failure?: boolean; immersive?: boolean; rear?: boolean; onStats?: (value: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const running = useRef<(() => void) | null>(null);
  const pausedRef = useRef(paused); pausedRef.current = paused;
  const report = useRef(onStats ?? (() => {})); report.current = onStats ?? (() => {});
  const [error, setError] = useState("");
  useEffect(() => { running.current?.(); }, [paused]);
  useEffect(() => {
    const container = host.current!; setError(""); report.current("");
    if (failure) { setError("表示の失敗を再現中。操作は続けられます。"); return; }
    let renderer: T.WebGLRenderer | undefined;
    let world: ReturnType<typeof createDrivingScene> | undefined;
    let loop: ReturnType<typeof createFrameLoop> | undefined;
    let observer: ResizeObserver | undefined;
    let teardown = () => {};
    let restTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
      renderer.domElement.setAttribute("aria-label", mode === "idle" ? "割当車両の3D表示" : "軽バンと低ポリ背景の3D表示");
      renderer.domElement.style.display = "block"; container.appendChild(renderer.domElement);
      world = createDrivingScene(mode, dark, immersive);
      if (rear && mode !== "off") { world.camera.position.set(6.55, 2.6, -7.3); world.camera.lookAt(1.55, 1, 0); }
      let frames = 0, lastStats = "";
      const draw = (delta: number) => {
        if (!renderer || !world) return;
        world.update(delta); renderer.render(world.scene, world.camera); frames++;
        renderer.domElement.dataset.frames = String(frames);
        renderer.domElement.dataset.calls = String(renderer.info.render.calls);
        renderer.domElement.dataset.triangles = String(renderer.info.render.triangles);
        const nextStats = `${renderer.info.render.triangles.toLocaleString()}三角形 / ${renderer.info.render.calls}描画 / テクスチャ${renderer.info.memory.textures}`;
        if (nextStats !== lastStats) { lastStats = nextStats; report.current(nextStats); }
      };
      loop = createFrameLoop(draw);
      const reduced = matchMedia("(prefers-reduced-motion: reduce)");
      const update = () => loop?.setActive(!document.hidden, !pausedRef.current && !reduced.matches && (mode === "working" || mode === "moving"));
      running.current = update;
      let orbit = 0;
      let pointer: { x: number; y: number; orbit: number } | null = null;
      const down = (event: PointerEvent) => { if (mode !== "off") return; pointer = { x: event.clientX, y: event.clientY, orbit }; renderer?.domElement.setPointerCapture(event.pointerId); };
      const move = (event: PointerEvent) => { if (!pointer || !world || mode !== "off") return; orbit = Math.max(-.35, Math.min(.35, pointer.orbit - (event.clientX - pointer.x) * .004)); world.setRestOrbit(orbit); draw(0); };
      const up = (event: PointerEvent) => {
        if (!pointer || !world || mode !== "off") return;
        const tapped = Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) < 9;
        pointer = null;
        if (!tapped) return;
        const rect = renderer!.domElement.getBoundingClientRect();
        if (!world.activateRestAt((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2)) return;
        if (restTimer) clearTimeout(restTimer);
        if (reduced.matches) { draw(0); return; }
        loop?.setActive(!document.hidden, true);
        restTimer = setTimeout(() => update(), 1200);
      };
      if (mode === "off") {
        renderer.domElement.style.touchAction = "pan-y";
        renderer.domElement.addEventListener("pointerdown", down);
        renderer.domElement.addEventListener("pointermove", move);
        renderer.domElement.addEventListener("pointerup", up);
        renderer.domElement.addEventListener("pointercancel", up);
      }
      const resize = () => { renderer!.setSize(container.clientWidth, container.clientHeight); world!.resize(container.clientWidth, container.clientHeight); update(); };
      observer = new ResizeObserver(resize); observer.observe(container); resize();
      document.addEventListener("visibilitychange", update); reduced.addEventListener("change", update);
      teardown = () => { document.removeEventListener("visibilitychange", update); reduced.removeEventListener("change", update); if (restTimer) clearTimeout(restTimer); renderer?.domElement.removeEventListener("pointerdown", down); renderer?.domElement.removeEventListener("pointermove", move); renderer?.domElement.removeEventListener("pointerup", up); renderer?.domElement.removeEventListener("pointercancel", up); };
    } catch (e) { setError(String(e)); }
    return () => { running.current = null; teardown(); observer?.disconnect(); loop?.dispose(); world?.dispose(); renderer?.dispose(); renderer?.domElement.remove(); };
  }, [mode, dark, failure, immersive, rear]);
  return <div ref={host} data-testid="scene-host" style={{ width: "100%", height: "100%", overflow: "hidden", background: mode === "idle" ? (dark ? "#121C2B" : "#F6F8FB") : "#9FC9EA", position: "relative" }}>
    {!!error && <img alt="車両・風景の静止表示" src={immersive ? sessionPoster : mode === "off" ? (dark ? offDarkPoster : offPoster) : (dark ? vanDarkPoster : vanPoster)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
  </div>;
}

export function SceneReview() {
  const [mode, setMode] = useState<SceneMode>("working");
  const [dark, setDark] = useState(false);
  const [paused, setPaused] = useState(false);
  const [failure, setFailure] = useState(false);
  const [rear, setRear] = useState(false);
  const [stats, setStats] = useState("");
  const button = { minHeight: 44, padding: "10px 15px", borderRadius: 12, border: "1px solid #CBD5E1", background: "white", color: "#192333" };
  return <div className="space-y-4">
    <div className="flex flex-wrap gap-2">
      {([['idle', '稼働前'], ['working', '稼働中'], ['moving', '車両移動'], ['off', '休み']] as const).map(([key, label]) => <button style={{ ...button, background: mode === key ? "#FFE6A0" : "white" }} key={key} aria-pressed={mode === key} onClick={() => setMode(key)}>{label}</button>)}
      <button style={button} onClick={() => setPaused(!paused)}>{paused ? "動きを再開" : "動きを止める"}</button>
      <button style={button} onClick={() => setRear(!rear)}>{rear ? "前から見る" : "後ろから見る"}</button>
      <button style={button} onClick={() => setDark(!dark)}>{dark ? "ライトへ" : "ダーク照明へ"}</button>
      <button style={button} onClick={() => setFailure(!failure)}>{failure ? "表示を復旧" : "表示失敗を試す"}</button>
    </div>
    <div style={{ maxWidth: 760, margin: "0 auto" }}>
      <div style={{ width: "100%", aspectRatio: mode === "idle" ? 2.15 : 1.34, borderRadius: 24, overflow: "hidden" }}><SceneSurface mode={mode} dark={dark} paused={paused} failure={failure} rear={rear} onStats={setStats} /></div>
      <p role="status" className="text-sm mt-3">{failure ? "表示の失敗を再現中。操作は続けられます。" : stats}</p>
    </div>
    <p className="text-sm text-brand-500">iPhoneと同じモデル・背景・描画処理を使用した隔離プレビューです。iPhoneでも車と流れる景色を確認済みです。MacのiOSシミュレーターはシート内が静止表示になります。ブラウザの性能値はiPhoneの性能を保証しません。ナンバーは架空データです。移動は演出でGPSとは連動していません。ダークは照明の確認用です。</p>
  </div>;
}
