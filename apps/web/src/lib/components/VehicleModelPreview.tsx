"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { createGltfLoader } from "@/lib/three/gltf-loader";
import { colorForVehicleMaterial, type VehiclePartColors } from "@/lib/vehicleAppearance";
import type { VehiclePlateData } from "@repo/core/types";
import { renderPlateImage } from "@/lib/plateImage";

const HEAD = new Set(["Headlight Lens"]);
const TAIL = new Set(["Rear Red Lens", "Light Brake High"]);
const isNight = () => { const h = (new Date().getUTCHours() + 9) % 24; return h >= 18 || h < 5; };

function disposeObject(root: THREE.Object3D) {
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse(obj => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(m);
  });
  for (const m of materials) {
    for (const v of Object.values(m)) if (v instanceof THREE.Texture) textures.add(v);
    m.dispose();
  }
  for (const t of textures) t.dispose();
}

/** 地図と同じGLBを表示。光は実際の灯火材質だけに付き、推測座標のスプライトは置かない。 */
export function VehicleModelPreview({ modelUrl, bodyColor, partColors = {}, plate, className, night }: {
  modelUrl: string; bodyColor?: string | null; partColors?: VehiclePartColors; plate?: VehiclePlateData; className?: string; night?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const appearance = useRef({ bodyColor, partColors, night: night ?? isNight() });
  appearance.current = { bodyColor, partColors, night: night ?? isNight() };
  const plateTexture = useRef<THREE.CanvasTexture | null>(null);
  const [plateError, setPlateError] = useState(false);
  const updateRef = useRef<() => void>(() => {});
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [retry, setRetry] = useState(0);
  const plateKey = [plate?.number_prefix, plate?.number_class, plate?.number_hiragana, plate?.number_numeric, plate?.plate_color].join("|");
  const plateRef = useRef(plate); plateRef.current = plate;
  useEffect(() => {
    let cancelled = false;
    const current = plateRef.current;
    setPlateError(false);
    plateTexture.current?.dispose(); plateTexture.current = null; updateRef.current();
    // 未入力を架空の番号で埋めず、番号が揃ったら共通の字形を描く。
    if (!current || ![current.number_prefix, current.number_class, current.number_hiragana, current.number_numeric].every(Boolean)) {
      return;
    }
    void renderPlateImage(current, 160).then(({ canvas, width, height, padding }) => {
      if (cancelled) { canvas.width = 0; canvas.height = 0; return; }
      const textureCanvas = document.createElement("canvas"); textureCanvas.width = 512; textureCanvas.height = 256;
      const scale = canvas.width / (width + padding * 2);
      textureCanvas.getContext("2d")!.drawImage(canvas, padding * scale, padding * scale, width * scale, height * scale, 0, 0, 512, 256);
      canvas.width = 0; canvas.height = 0;
      const texture = new THREE.CanvasTexture(textureCanvas); texture.colorSpace = THREE.SRGBColorSpace; texture.flipY = false;
      plateTexture.current?.dispose(); plateTexture.current = texture; updateRef.current();
    }).catch(() => { if (!cancelled) setPlateError(true); });
    return () => { cancelled = true; plateTexture.current?.dispose(); plateTexture.current = null; };
  }, [plateKey, retry]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    setStatus("loading");
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); }
    catch { setStatus("error"); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const canvas = renderer.domElement;
    canvas.setAttribute("aria-label", "車両の3D表示。ドラッグまたは左右キーで回転");
    canvas.setAttribute("role", "img");
    canvas.tabIndex = 0;
    canvas.style.touchAction = "pan-y";
    canvas.style.cursor = "grab";
    host.appendChild(canvas);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 100);
    const pivot = new THREE.Group();
    pivot.rotation.y = -Math.PI * 0.28;
    scene.add(pivot);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    const environment = pmrem.fromScene(room, 0.04);
    room.dispose(); pmrem.dispose();
    scene.environment = environment.texture;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa4b2, 1));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(3, 5, 4); scene.add(key);
    let disposed = false;
    let radius = 2;
    let model: THREE.Object3D | null = null;
    const materials = new Set<THREE.MeshStandardMaterial>();
    const originals = new Map<THREE.MeshStandardMaterial, THREE.Color>();
    const render = () => { if (!disposed) renderer.render(scene, camera); };
    const resize = () => {
      const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
      renderer.setSize(w, h);
      camera.aspect = w / h;
      const vertical = THREE.MathUtils.degToRad(camera.fov);
      const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * camera.aspect);
      const distance = radius / Math.sin(Math.min(vertical, horizontal) / 2) * 1.05;
      camera.position.set(0, distance * 0.22, distance);
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix(); render();
    };
    const apply = () => {
      const { bodyColor: color, partColors: parts, night: dark } = appearance.current;
      for (const m of materials) {
        const paint = colorForVehicleMaterial(m.name, color, parts);
        if (paint) m.color.set(paint); else m.color.copy(originals.get(m)!);
        if (/plate/i.test(m.name)) {
          m.map = plateTexture.current;
          if (m.map) { m.color.set(0xffffff); m.metalness = 0; m.roughness = .8; }
          m.needsUpdate = true;
        }
        if (HEAD.has(m.name) || TAIL.has(m.name)) {
          m.emissive.set(dark ? (HEAD.has(m.name) ? 0xfff1cf : 0xff2515) : 0x000000);
          m.emissiveIntensity = dark ? 2.5 : 0;
        }
      }
      key.intensity = dark ? 0.55 : 1.1;
      renderer.toneMappingExposure = dark ? 0.9 : 1.15;
      render();
    };
    updateRef.current = apply;
    const observer = new ResizeObserver(resize); observer.observe(host); resize();
    createGltfLoader().load(modelUrl, gltf => {
      if (disposed) { disposeObject(gltf.scene); return; }
      model = gltf.scene;
      model.traverse(obj => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh) return;
        for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          if (m instanceof THREE.MeshStandardMaterial) {
            materials.add(m); originals.set(m, m.color.clone());
            if (m.transparent) m.depthWrite = false;
          }
        }
      });
      const box = new THREE.Box3().setFromObject(model);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      radius = box.getBoundingSphere(new THREE.Sphere()).radius * 0.75;
      model.position.sub(center);
      pivot.add(model); // 中心移動は子へ、回転は親へ。灯火面と車体は同じ変換を受ける。
      const shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshBasicMaterial({
        color: 0x0f172a, transparent: true, opacity: 0.1, depthWrite: false,
      }));
      shadow.rotation.x = -Math.PI / 2;
      shadow.scale.set(size.x * 0.48, size.z * 0.48, 1);
      shadow.position.y = -size.y / 2 + 0.005;
      pivot.add(shadow);
      setStatus("ready"); resize(); apply();
    }, undefined, () => { if (!disposed) setStatus("error"); });

    let dragging = false, lastX = 0;
    const down = (e: PointerEvent) => { dragging = true; lastX = e.clientX; canvas.setPointerCapture(e.pointerId); canvas.style.cursor = "grabbing"; };
    const move = (e: PointerEvent) => { if (dragging) { pivot.rotation.y += (e.clientX - lastX) * 0.01; lastX = e.clientX; render(); } };
    const up = () => { dragging = false; canvas.style.cursor = "grab"; };
    const keyboard = (e: KeyboardEvent) => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); pivot.rotation.y += e.key === "ArrowLeft" ? -0.2 : 0.2; render(); } };
    canvas.addEventListener("pointerdown", down); canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up); canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("keydown", keyboard);
    return () => {
      disposed = true; updateRef.current = () => {};
      observer.disconnect();
      canvas.removeEventListener("pointerdown", down); canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up); canvas.removeEventListener("pointercancel", up); canvas.removeEventListener("keydown", keyboard);
      for (const m of materials) if (m.map === plateTexture.current) m.map = null;
      disposeObject(scene); environment.dispose(); renderer.dispose(); canvas.remove();
    };
  }, [modelUrl, retry]);
  useEffect(() => { updateRef.current(); }, [bodyColor, partColors, night]);
  return <div className={`relative ${className ?? ""}`} data-model-url={modelUrl}>
    <div ref={hostRef} className="h-full w-full" />
    {plateError && <button type="button" onClick={() => setRetry(v => v + 1)} className="absolute bottom-1 left-2 rounded bg-white/90 px-2 py-1 text-xs text-amber-900">ナンバーを再読み込み</button>}
    {status !== "ready" && <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-50 text-sm text-slate-500" role="status">
      {status === "loading" ? "車両を表示しています…" : <><span>車両を表示できませんでした</span><button type="button" className="min-h-11 rounded px-3 text-slate-700 underline" onClick={() => setRetry(v => v + 1)}>再読み込み</button></>}
    </div>}
  </div>;
}
