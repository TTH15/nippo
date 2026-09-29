// @refresh reset
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AccessibilityInfo, AppState, Image, Pressable, Text, View } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { GLView, type ExpoWebGLRenderingContext } from "expo-gl";
import * as T from "three";
import { createDrivingScene, type SceneMode } from "./create-scene";
import { createFrameLoop } from "./frame-loop";

// このファイルはui-preview専用。実機計測値はGPU時間ではなくJS描画呼出しの診断値。
type Diagnostic = { mode: SceneMode; frames: number; calls: number; triangles: number; geometries: number; textures: number; lastRenderMs: number; rendererName?: string; error?: string };
export const sceneDiagnostics = new Map<number, Diagnostic>();
let nextId = 0;

function SceneCanvas({ mode, immersive, visible, animate, allowRestMotion, width, height, onError, onReady }: { mode: SceneMode; immersive: boolean; visible: boolean; animate: boolean; allowRestMotion: boolean; width: number; height: number; onError: (message: string) => void; onReady: () => void }) {
  const controller = useRef<ReturnType<typeof createFrameLoop> | null>(null);
  const release = useRef<(() => void) | null>(null);
  const restWorld = useRef<ReturnType<typeof createDrivingScene> | null>(null);
  const renderOnce = useRef<(() => void) | null>(null);
  const restTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restGesture = useRef<{ x: number; y: number; orbit: number } | null>(null);
  const restOrbit = useRef(0);
  const alive = useRef(true);
  const flags = useRef({ visible, animate }); flags.current = { visible, animate };
  useEffect(() => { alive.current = true; return () => { alive.current = false; if (restTimer.current) clearTimeout(restTimer.current); controller.current?.dispose(); release.current?.(); }; }, []);
  useEffect(() => { controller.current?.setActive(visible, animate); }, [visible, animate]);
  const create = (gl: ExpoWebGLRenderingContext) => {
    if (!alive.current) return;
    controller.current?.dispose(); release.current?.();
    let renderer: T.WebGLRenderer | undefined;
    let world: ReturnType<typeof createDrivingScene> | undefined;
    const id = ++nextId; const diagnostic: Diagnostic = { mode, frames: 0, calls: 0, triangles: 0, geometries: 0, textures: 0, lastRenderMs: 0 };
    sceneDiagnostics.set(id, diagnostic);
    let disposed = false;
    release.current = () => { if (disposed) return; disposed = true; try { world?.dispose(); renderer?.dispose(); } finally { sceneDiagnostics.delete(id); } };
    try {
      diagnostic.rendererName = String(gl.getParameter(gl.RENDERER));
      // iOS26 Simulatorのsoftware rendererはnative sheet内で描画結果が空白になる。
      // 実機には適用せず、Macは同じシーンのブラウザ版で動きを確認する。
      if (diagnostic.rendererName === "Apple Software Renderer" && (mode === "working" || mode === "moving")) throw new Error("SIMULATOR_SHEET_GL_UNAVAILABLE");
      // DOMを持たないExpo GL用。イベントはGLView/Reactが管理し、サイズはネイティブのbufferを使用。
      const canvas = { width: gl.drawingBufferWidth, height: gl.drawingBufferHeight, style: {}, addEventListener() {}, removeEventListener() {}, setAttribute() {}, getContext: () => gl } as unknown as HTMLCanvasElement;
      // Expo57のWebGL2はWebGL1を継承するため、Three r180のinstanceof検査と衝突する。
      // 実コンテキストのWebGL2能力を確認してから、グローバルを変更せずローカルに橋渡し。
      if (typeof gl.createVertexArray !== "function" || !/(WebGL 2|OpenGL ES 3)/.test(String(gl.getParameter(gl.VERSION)))) throw new Error(`WebGL2 context required: ${String(gl.getParameter(gl.VERSION))}, vertexArray=${typeof gl.createVertexArray}`);
      const methods = new Map<PropertyKey, unknown>();
      const context = new Proxy({} as WebGL2RenderingContext, { get(_target, key) {
        if (key === "canvas") return canvas;
        const value = Reflect.get(gl, key);
        if (typeof value !== "function") return value;
        if (!methods.has(key)) methods.set(key, value.bind(gl));
        return methods.get(key);
      } });
      renderer = new T.WebGLRenderer({ canvas, context, antialias: false, alpha: false });
      renderer.setSize(gl.drawingBufferWidth, gl.drawingBufferHeight, false);
      renderer.setPixelRatio(1); renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
      world = createDrivingScene(mode, false, immersive); world.resize(gl.drawingBufferWidth, gl.drawingBufferHeight);
      restWorld.current = world;
      const draw = (seconds: number) => {
        if (disposed || !alive.current || !renderer || !world) return;
        try {
          const start = performance.now(); world.update(seconds);
          // iOSシートのレイアウト確定でExpoが描画先を再作成する。Threeのcache外で最新のdefaultへ戻す。
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          renderer.render(world.scene, world.camera); gl.flush(); gl.endFrameEXP();
          diagnostic.frames++; Object.assign(diagnostic, { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, lastRenderMs: performance.now() - start });
          if (diagnostic.frames === 1) onReady();
        } catch (error) { controller.current?.dispose(); diagnostic.error = String(error); onError(String(error)); }
      };
      renderOnce.current = () => draw(0);
      controller.current = createFrameLoop(draw);
      controller.current.setActive(flags.current.visible, flags.current.animate);
    } catch (error) { onError(String(error)); }
  };
  return <GLView collapsable={false} style={{ flex: 1 }} msaaSamples={2} onContextCreate={create}
    onTouchStart={event => { if (mode !== "off") return; const touch = event.nativeEvent.touches[0]; if (touch) restGesture.current = { x: touch.pageX, y: touch.pageY, orbit: restOrbit.current }; }}
    onTouchMove={event => { if (mode !== "off" || !restGesture.current) return; const touch = event.nativeEvent.touches[0]; if (!touch) return; if (Math.abs(touch.pageX - restGesture.current.x) <= Math.abs(touch.pageY - restGesture.current.y)) return; restOrbit.current = Math.max(-.35, Math.min(.35, restGesture.current.orbit - (touch.pageX - restGesture.current.x) * .004)); restWorld.current?.setRestOrbit(restOrbit.current); renderOnce.current?.(); }}
    onTouchEnd={event => { if (mode !== "off" || !restGesture.current) return; const touch = event.nativeEvent.changedTouches[0]; const start = restGesture.current; restGesture.current = null; if (!touch || Math.hypot(touch.pageX - start.x, touch.pageY - start.y) >= 9) return; if (!restWorld.current?.activateRestAt(touch.locationX / width * 2 - 1, 1 - touch.locationY / height * 2)) return; if (restTimer.current) clearTimeout(restTimer.current); if (!allowRestMotion) { renderOnce.current?.(); return; } controller.current?.setActive(flags.current.visible, true); restTimer.current = setTimeout(() => controller.current?.setActive(flags.current.visible, flags.current.animate), 1200); }}
    onTouchCancel={() => { restGesture.current = null; }} />;
}

export function VehicleScene({ mode, presented = true, immersive = false, compactHeight, children }: { mode: SceneMode; compactHeight?: number; presented?: boolean; immersive?: boolean; children?: ReactNode }) {
  const focused = useIsFocused();
  const [foreground, setForeground] = useState(AppState.currentState === "active");
  const [reduceMotion, setReduceMotion] = useState(true);
  const [paused, setPaused] = useState(false);
  const [poster, setPoster] = useState(false);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState(0);
  useEffect(() => { setReady(false); }, [mode, width, height, focused, foreground]);
  useEffect(() => {
    if (ready || poster || error || !focused || !foreground) return;
    const timer = setTimeout(() => setError("3Dの読み込みが完了しませんでした"), 12000);
    return () => clearTimeout(timer);
  }, [ready, poster, error, focused, foreground, mode, width, attempt]);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then(value => { if (alive) setReduceMotion(value); }).catch(() => {});
    const a = AppState.addEventListener("change", state => setForeground(state === "active"));
    const b = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => { alive = false; a.remove(); b.remove(); };
  }, []);
  const moving = mode === "working" || mode === "moving";
  const showPoster = poster || !!error;
  const simulatorFallback = error.includes("SIMULATOR_SHEET_GL_UNAVAILABLE");
  const source = immersive ? require("./assets/session-poster.png") : mode === "off" ? require("./assets/off-poster.png") : require("./assets/van-poster.png");
  return <View style={immersive ? { flex: 1, backgroundColor: "#9FC9EA" } : { gap: 8 }}>
    <View collapsable={false} onLayout={event => { setWidth(Math.round(event.nativeEvent.layout.width)); setHeight(Math.round(event.nativeEvent.layout.height)); }} accessibilityLabel={mode === "off" ? "休みの日の3D風景" : "エブリイの3D表示"} style={immersive ? { position: "absolute", inset: 0, overflow: "hidden" } : { width: "100%", ...(compactHeight ? { height: compactHeight } : { aspectRatio: mode === "idle" ? 2.15 : 1.34 }), overflow: "hidden", borderRadius: 22, backgroundColor: mode === "idle" ? "#F6F8FB" : "#DCE8ED" }}>
      {showPoster ? <Image source={source} style={{ width: "100%", height: "100%" }} /> : presented && focused && foreground && width > 0 && <SceneCanvas key={`${mode}:${attempt}:${width}:${height}`} mode={mode} immersive={immersive} visible={focused && foreground} animate={moving && !paused && !reduceMotion} allowRestMotion={!reduceMotion} width={width} height={height} onReady={() => setReady(true)} onError={message => { console.warn("[scene-preview]", message); setError(message); }} />}
      {!showPoster && <View pointerEvents="none" style={{ position: "absolute", width: "100%", height: "100%", opacity: ready ? 0 : 1 }}><Image source={source} style={{ width: "100%", height: "100%" }} /></View>}
      {!showPoster && <Text pointerEvents="none" style={{ opacity: ready ? 0 : 1, position: "absolute", bottom: 12, alignSelf: "center", color: "#526074" }}>{mode === "off" ? "風景を読み込み中" : "車両を読み込み中"}</Text>}
    </View>
    {children}
    {mode !== "idle" && mode !== "off" && <View style={immersive ? { position: "absolute", top: 120, left: 24, right: 24, flexDirection: "row", gap: 18, alignItems: "center" } : { flexDirection: "row", gap: 18, alignItems: "center" }}>
      {moving && !showPoster && !reduceMotion && <Pressable testID="toggle-scene-motion" accessibilityRole="button" onPress={() => setPaused(value => !value)} style={{ minHeight: 44, justifyContent: "center" }}><Text style={{ color: immersive ? "#F3F6FB" : "#748BA6", fontSize: 12 }}>{paused ? "動きを再開" : "動きを止める"}</Text></Pressable>}
      <Pressable disabled={simulatorFallback} testID="toggle-scene-poster" accessibilityRole="button" onPress={() => { setReady(false); setError(""); setPoster(!showPoster); setAttempt(value => value + 1); }} style={{ minHeight: 44, justifyContent: "center" }}><Text style={{ color: immersive ? "#F3F6FB" : "#748BA6", fontSize: 12 }}>{simulatorFallback ? "この環境では静止表示" : showPoster ? "3Dを再表示" : "静止画で表示"}</Text></Pressable>
      {!!error && !simulatorFallback && <Text style={{ color: immersive ? "#F3F6FB" : "#748BA6", fontSize: 12 }}>車両の表示を切り替えました</Text>}
    </View>}
  </View>;
}
