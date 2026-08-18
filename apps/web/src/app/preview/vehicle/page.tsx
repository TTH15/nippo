"use client";

// ============================================================
// 車両3Dモデルのプレビュー（開発用・認証不要）。
// 様式化ローポリの軽バン（scripts/blender-mcp/models/keivan.py が正本）を、
// 実際に使う4つの状況で並べて確認する:
//   1. 昼 / 2. 夜（three.js。詳細画面の想定）
//   3. 地図（昼） / 4. 地図（夜）（Mapbox の model レイヤー。実際の描画設定と同じ）
// ============================================================

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

const MODEL_URL = "/models/keivan.glb";
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

/** 地図と同じ考え方で車体だけ着色する（白い body マテリアルに色を乗算）。 */
function tintBody(scene: THREE.Object3D, color: string | null) {
  if (!color) return;
  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of materials) {
      const mat = m as THREE.MeshStandardMaterial;
      if (!mat?.name) continue;
      // 車体（白）だけ着色する。窓・タイヤ・グリルは暗いまま残す
      if (mat.name.includes("body")) mat.color.set(color);
    }
  });
}

type SceneMode = "day" | "night";

function VehicleCanvas({
  mode,
  bodyColor,
  autoRotate,
  height = 320,
}: {
  mode: SceneMode;
  bodyColor?: string | null;
  autoRotate?: boolean;
  height?: number;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const isNight = mode === "night";
    const width = host.clientWidth || 480;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(isNight ? 0x0d1117 : 0xeef1f5);

    const camera = new THREE.PerspectiveCamera(32, width / height, 0.1, 100);

    // 昼: 高い太陽＋明るい環境光 / 夜: 弱い青い環境光＋低い暖色のキーライト
    if (isNight) {
      scene.add(new THREE.HemisphereLight(0x2a3550, 0x05070c, 0.55));
      const key = new THREE.DirectionalLight(0xffd9a0, 1.1);
      key.position.set(3, 2.2, 2.5);
      scene.add(key);
      const rim = new THREE.DirectionalLight(0x6fa8ff, 0.7);
      rim.position.set(-3, 1.6, -2);
      scene.add(rim);
    } else {
      scene.add(new THREE.HemisphereLight(0xffffff, 0xb9c2cc, 1.15));
      const sun = new THREE.DirectionalLight(0xfff6e5, 2.0);
      sun.position.set(4, 6, 3);
      scene.add(sun);
    }

    // 接地感のための床
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(6, 48),
      new THREE.MeshStandardMaterial({ color: isNight ? 0x11161f : 0xdfe4ea, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);

    const pivot = new THREE.Group();
    scene.add(pivot);

    let raf = 0;
    let disposed = false;

    new GLTFLoader().load(
      MODEL_URL,
      (gltf) => {
        if (disposed) return;
        tintBody(gltf.scene, bodyColor ?? null);
        pivot.add(gltf.scene);

        // モデルは原点=底面中心。全体が収まる距離にカメラを置く
        const box = new THREE.Box3().setFromObject(gltf.scene);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const radius = size.length() / 2;
        camera.position.set(radius * 1.9, radius * 1.15, radius * 2.1);
        camera.lookAt(center);

        const start = performance.now();
        const tick = () => {
          if (disposed) return;
          if (autoRotate) pivot.rotation.y = ((performance.now() - start) / 1000) * 0.6;
          renderer.render(scene, camera);
          raf = requestAnimationFrame(tick);
        };
        tick();
      },
      undefined,
      () => setError("モデルを読み込めませんでした（/models/keivan.glb）"),
    );

    const onResize = () => {
      const w = host.clientWidth || width;
      renderer.setSize(w, height);
      camera.aspect = w / height;
      camera.updateProjectionMatrix();
    };
    window.addEventListener("resize", onResize);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      renderer.dispose();
      host.removeChild(renderer.domElement);
    };
  }, [mode, bodyColor, autoRotate, height]);

  return (
    <div className="relative">
      <div ref={hostRef} style={{ height }} className="w-full overflow-hidden rounded-lg" />
      {error && (
        <p className="absolute inset-0 flex items-center justify-center text-sm text-red-600">{error}</p>
      )}
    </div>
  );
}

/** Mapbox の model レイヤー。地図画面と同じ paint 設定で並べる。 */
function MapCanvas({ lightPreset }: { lightPreset: "day" | "night" }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !MAPBOX_TOKEN) return;
    mapboxgl.accessToken = MAPBOX_TOKEN;
    const map = new mapboxgl.Map({
      container: host,
      style: "mapbox://styles/mapbox/standard",
      // ★建物の軒下だと車が埋まって見えないので、開けた広い通り（御池通）に置く
      center: [135.7683, 35.0108],
      zoom: 18.6,
      pitch: 48,
      bearing: 12,
      attributionControl: false,
    });

    map.on("style.load", () => {
      map.setConfigProperty("basemap", "lightPreset", lightPreset);

      map.addModel("keivan", MODEL_URL);
      map.addSource("vehicles", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          // 実際の運用と同じく、車両ごとに色と向きを持たせる
          features: [
            { color: "#ffffff", rotation: 100, dx: -0.00010, dy: 0.00002 },
            { color: "#1d4ed8", rotation: 100, dx: -0.00003, dy: 0.00002 },
            { color: "#dc2626", rotation: 100, dx: 0.00004, dy: 0.00002 },
            { color: "#111827", rotation: 280, dx: 0.00011, dy: -0.00004 },
          ].map((v, i) => ({
            type: "Feature" as const,
            id: i,
            properties: { color: v.color, rotation: [0, 0, v.rotation] },
            geometry: {
              type: "Point" as const,
              coordinates: [135.7683 + v.dx, 35.0108 + v.dy],
            },
          })),
        },
      });
      map.addLayer({
        id: "vehicles-3d",
        type: "model",
        source: "vehicles",
        layout: { "model-id": "keivan" },
        paint: {
          "model-rotation": ["get", "rotation"],
          "model-color": ["get", "color"],
          // 塗り分けマスク付きなので強く混ぜない（地図画面と同じ 0.45）
          "model-color-mix-intensity": 0.45,
          "model-emissive-strength": 1,
          "model-scale": [2.2, 2.2, 2.2],
        },
      });
    });

    return () => map.remove();
  }, [lightPreset]);

  if (!MAPBOX_TOKEN) {
    return (
      <div className="flex h-[320px] items-center justify-center rounded-lg bg-slate-100 text-sm text-slate-500">
        NEXT_PUBLIC_MAPBOX_TOKEN が未設定のため地図は表示できません
      </div>
    );
  }
  return <div ref={hostRef} className="h-[320px] w-full overflow-hidden rounded-lg" />;
}

function Panel({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {note && <p className="mt-0.5 text-xs text-slate-500">{note}</p>}
      </div>
      {children}
    </section>
  );
}

export default function VehiclePreviewPage() {
  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-6xl">
        <h1 className="text-xl font-bold text-slate-900">車両モデルのプレビュー</h1>
        <p className="mt-1 text-sm text-slate-600">
          軽バン（様式化ローポリ・490三角形）。正本は
          <code className="mx-1 rounded bg-slate-200 px-1 py-0.5 text-xs">
            scripts/blender-mcp/models/keivan.py
          </code>
        </p>

        <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Panel title="昼" note="詳細画面の想定。高い太陽＋明るい環境光">
            <VehicleCanvas mode="day" />
          </Panel>
          <Panel title="夜" note="低い暖色のキーライト＋青いリムライト">
            <VehicleCanvas mode="night" />
          </Panel>

          <Panel title="車両詳細（回転）" note="白＝着色なし。窓・タイヤは暗いまま残る">
            <VehicleCanvas mode="day" autoRotate height={340} />
          </Panel>
          <Panel title="車両詳細（着色・回転）" note="body マテリアルにだけ色を乗算">
            <VehicleCanvas mode="day" autoRotate bodyColor="#1d4ed8" height={340} />
          </Panel>

          <Panel title="地図（昼）" note="Mapbox model レイヤー / model-color-mix-intensity 0.45">
            <MapCanvas lightPreset="day" />
          </Panel>
          <Panel title="地図（夜）" note="lightPreset=night。model-emissive-strength 1 で沈ませない">
            <MapCanvas lightPreset="night" />
          </Panel>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { label: "白（既定）", color: null },
            { label: "青", color: "#1d4ed8" },
            { label: "赤", color: "#dc2626" },
            { label: "黒", color: "#111827" },
          ].map((v) => (
            <Panel key={v.label} title={v.label}>
              <VehicleCanvas mode="day" bodyColor={v.color} height={190} />
            </Panel>
          ))}
        </div>
      </div>
    </main>
  );
}
