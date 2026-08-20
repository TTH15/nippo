"use client";

// ============================================================
// 車両3Dモデルのプレビュー（開発用・認証不要）。
// 様式化ローポリの軽バン（scripts/blender-mcp/models/keivan.py が正本）を、
// 実際に使う4つの状況で並べて確認する:
//   1. 昼 / 2. 夜（three.js。詳細画面の想定）
//   3. 地図（昼） / 4. 地図（夜）（Mapbox の model レイヤー。実際の描画設定と同じ）
// ============================================================

import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { createGltfLoader } from "@/lib/three/gltf-loader";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

// ★モデルを作り直しても古い glb をブラウザが掴み続けるので、読み込みごとに変える。
//   開発用プレビュー専用の割り切り（93KB）。
const MODEL_URL = `/models/keivan.glb?t=${Date.now()}`;
// ★地図用は「着色される部分（車体）」と「着色しない部分（窓・タイヤ・灯火）」に
//   分けた2ファイル。Mapbox の model-color は**モデル全体**に掛かりマテリアル単位で
//   選べないため、レイヤーを2枚重ねて車体だけに色を乗せる（2026-08-19 実験で確定）。
// 車種のカタログ。Meshy 生成 → keivan_from_scan.py で減面したもの
const VEHICLE_MODELS = [
  { key: "clipper", label: "日産 NV100 クリッパー（＝エブリイ OEM）", url: "/models/keivan.glb", note: "手書きの旧モデル。塗り分け済み" },
  { key: "acty", label: "ホンダ アクティバン（従来の減面 Collapse）", url: "/models/acty_v2.glb", note: "19,774 三角形。稜線が丸まって滑らかに見える" },
];

// 減面のしきい値による比較。**Planar（平面統合）**は稜線を残して平面を潰すので、
// Collapse と同じ枚数でも「どこに三角形が使われているか」が違う。
// さらに**車輪をきれいな円柱に差し替え**てある（スキャンのハブはノイズだらけで
// 数千三角形を食うが、車種識別には寄与しない）。
const PLANAR_VARIANTS = [
  { angle: 12, tris: "47,336", size: "2.5MB", url: "/models/acty_n12.glb" },
  { angle: 18, tris: "36,750", size: "1.6MB", url: "/models/acty_n18.glb" },
  { angle: 24, tris: "31,407", size: "1.4MB", url: "/models/acty_n24.glb" },
];

// 詳細表示向けのローポリ候補。形状は平面統合で軽量化するが、窓・ライト・グリルは
// 面単位に塗り直さず、縮小した原本テクスチャで輪郭を保つ。
const LOWPOLY_TEXTURED_MODELS = [
  {
    key: "a",
    title: "候補 A（旧原本）",
    url: "/models/acty_lowpoly_textured.glb",
    tris: "112,488",
    size: "1.3MB",
  },
  {
    key: "b",
    title: "候補 B（新原本・推奨）",
    url: "/models/acty2_lowpoly.glb",
    tris: "189,598",
    size: "1.7MB",
  },
];

// ★塗り分け済み（2026-08-20）。Meshy の生成モデルは**テクスチャに塗り分けが焼かれて
//   いる**ので、面の UV でベースカラーを引けば部位が分かる。手作業は要らなくなった。
//   詳細ページ用は窓枠・グリルまで残す（black マテリアル）。
const TEXTURED_VARIANTS: { angle: number; tris: string; size: string; url: string; note?: string }[] = [
  { angle: 30, tris: "105,568", size: "0.79MB", url: "/models/acty_detail.glb", note: "詳細ページ用（Draco圧縮）" },
  { angle: 18, tris: "60,693", size: "2.9MB", url: "/models/actytex_n18.glb", note: "旧（Collapse下ごしらえ）" },
  { angle: 45, tris: "46,655", size: "2.4MB", url: "/models/actytex_n45.glb", note: "旧（Collapse下ごしらえ）" },
  { angle: 24, tris: "9,974", size: "0.5MB", url: "/models/actymap_b.glb", note: "地図用（粗）" },
];

// 画面上の見かけを一定に保つ倍率。z19 で 3.0倍（地図幅の 8% 前後）を基準に、
// 1ズームごとに半分（＝見かけ一定）。本番の地図画面も同じ考え方で truckScaleAt を持っている。
// ★各段の値も **3要素の配列** で渡す（数値だと
//   「Expected array<number, 3> but found number」で落ちる。2026-08-20 実測）
const MODEL_SCALE = [
  "interpolate", ["exponential", 2], ["zoom"],
  17, ["literal", [12, 12, 12]],
  18, ["literal", [6, 6, 6]],
  19, ["literal", [3, 3, 3]],
  20, ["literal", [1.5, 1.5, 1.5]],
  21, ["literal", [0.75, 0.75, 0.75]],
] as unknown as mapboxgl.ExpressionSpecification;

const MODEL_TINTED = `/models/actymap_b_tinted.glb?t=${Date.now()}`;
const MODEL_FIXED = `/models/actymap_b_fixed.glb?t=${Date.now()}`;
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
      if (mat.name.includes("body")) {
        mat.color.set(color);
        continue;
      }
      // 面単位にマテリアル分けしていないモデルは、元テクスチャの白系画素だけを
      // シェーダーで着色する。窓などの暗部と灯火の有彩色は元の色を保つ。
      if (!mat.map) continue;
      const tint = new THREE.Color(color);
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.bodyTint = { value: tint };
        shader.fragmentShader = shader.fragmentShader
          .replace(
            "#include <common>",
            "#include <common>\nuniform vec3 bodyTint;",
          )
          .replace(
            "#include <map_fragment>",
            `#include <map_fragment>
            float tintMax = max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b));
            float tintMin = min(diffuseColor.r, min(diffuseColor.g, diffuseColor.b));
            float tintChroma = tintMax - tintMin;
            float bodyMask = smoothstep(0.62, 0.88, tintMax)
              * (1.0 - smoothstep(0.07, 0.18, tintChroma));
            diffuseColor.rgb = mix(diffuseColor.rgb, bodyTint * tintMax, bodyMask);`,
          );
      };
      mat.customProgramCacheKey = () => `body-texture-tint-${color}`;
      mat.needsUpdate = true;
    }
  });
}

type SceneMode = "day" | "night";

/**
 * 画面に近づいたら true を返す。
 *
 * ★WebGL のコンテキストはブラウザ全体で 16 個ほどが上限。このページはパネルを
 *   並べるので簡単に超え、超えると**先に作られたものから黙って失われる**。
 *   実測では 19 個並べた状態で地図（4・5番目）のコンテキストが死に、
 *   Mapbox は「描画した」と答えるのに画面は真っ白、という状態になっていた。
 */
function useNearViewport(ref: React.RefObject<HTMLElement | null>, margin = "0px") {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setNear(e.isIntersecting), { rootMargin: margin });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, margin]);
  return near;
}

function VehicleCanvas({
  mode,
  bodyColor,
  autoRotate,
  height = 320,
  url,
  onStats,
}: {
  mode: SceneMode;
  bodyColor?: string | null;
  autoRotate?: boolean;
  height?: number;
  /** 読み込むモデル。省略時は既定の軽バン */
  url?: string;
  /** 読み込んだモデルの実測値。ページ見出しに出す（数値の直書きは必ず古くなる） */
  onStats?: (stats: { triangles: number; meshes: number }) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const visible = useNearViewport(hostRef);

  useEffect(() => {
    const host = hostRef.current;
    // ★画面外では作らない。WebGL のコンテキストはブラウザ全体で 16 個ほどが上限で、
    //   このページはパネルを並べるとすぐ超える。超えると**古い順に黙って失われ**、
    //   先に作られた地図が真っ白になる（2026-08-20 実測。isContextLost() で確認した）。
    if (!host || !visible) return;

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

    createGltfLoader().load(
      url ?? MODEL_URL,
      (gltf) => {
        if (disposed) return;
        tintBody(gltf.scene, bodyColor ?? null);
        pivot.add(gltf.scene);

        if (onStats) {
          let triangles = 0;
          let meshes = 0;
          gltf.scene.traverse((obj) => {
            const mesh = obj as THREE.Mesh;
            if (!mesh.isMesh) return;
            meshes += 1;
            const index = mesh.geometry.getIndex();
            const count = index ? index.count : mesh.geometry.getAttribute("position").count;
            triangles += count / 3;
          });
          onStats({ triangles, meshes });
        }

        // モデルは原点=底面中心。全体が収まる距離にカメラを置く
        const box = new THREE.Box3().setFromObject(gltf.scene);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const radius = size.length() / 2;
        camera.position.set(radius * 1.9, radius * 1.15, radius * 2.1);
        camera.lookAt(center);

        // ★回転しないパネルは1回描いて止める。8枚が常時 rAF を回すとページが固まり、
        //   スクリーンショットがタイムアウトした（2026-08-18 実測）
        if (!autoRotate) {
          renderer.render(scene, camera);
        } else {
          const start = performance.now();
          const tick = () => {
            if (disposed) return;
            pivot.rotation.y = ((performance.now() - start) / 1000) * 0.6;
            renderer.render(scene, camera);
            raf = requestAnimationFrame(tick);
          };
          tick();
        }
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
  }, [mode, bodyColor, autoRotate, height, url, onStats, visible]);

  return (
    <div className="relative">
      <div ref={hostRef} style={{ height }} className="w-full overflow-hidden rounded-lg" />
      {error && (
        <p className="absolute inset-0 flex items-center justify-center text-sm text-red-600">{error}</p>
      )}
    </div>
  );
}

/**
 * ヘッドライトの光だまり（地面に落ちる光）。
 *
 * ★Mapbox の model レイヤーは**模型から光を出せない**。`model-emissive-strength` は
 *   面を自己発光させるだけで光源にはならない（2026-08-19 実験で確認）。
 *   そこで地面に扇形のポリゴンを描いて偽装する。
 *
 * アイコン（symbol）ではなく**実座標のポリゴン**にしてある。symbol は大きさが
 * 画面ピクセル基準なので、ズームしても光だまりの大きさが変わらず、車とちぐはぐになる。
 */
// 実測で後ろに出たので 180（モデルの向き・model-rotation・方位角の3つのズレ分）
const HEADLIGHT_HEADING_OFFSET = 180;

// ★車間は 20m 取る。6m だと車がほぼ接し、**光だまりが前の車の下に潜って見えなくなる**
//   （2026-08-19: queryRenderedFeatures で「描画はされているが車の下」と判明）
const VEHICLES = [
  { color: "#ffffff", rotation: 100, dx: -0.00014, dy: 0.00002 },
  { color: "#1d4ed8", rotation: 100, dx: -0.00005, dy: 0.00001 },
  { color: "#dc2626", rotation: 100, dx: 0.00005, dy: 0.00000 },
  { color: "#111827", rotation: 280, dx: 0.00014, dy: -0.00002 },
];

/** ヘッドライト光の画像を描く。**本物のグラデーション**にするための素材。
 *
 * ★半透明ポリゴンを重ねる方式では、枚数ぶんの階段になって境界が見える
 *   （2026-08-20 ユーザー指摘）。画像なら滑らかに減衰させられる。
 *   画像は「上向き」に描き、地図側で車の向きへ回す。
 */
const BEAM_PX = 512;
const BEAM_LENGTH_M = 15; // 画像の高さに相当する実距離

function makeBeamImage(): ImageData {
  const c = document.createElement("canvas");
  c.width = c.height = BEAM_PX;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, BEAM_PX, BEAM_PX);
  // 重なりを加算にして、左右の光が合流する部分を明るくする
  ctx.globalCompositeOperation = "lighter";
  ctx.filter = "blur(10px)"; // 縁を柔らかく

  const originY = BEAM_PX - 8;
  for (const sideSign of [-1, 1]) {
    const originX = BEAM_PX / 2 + sideSign * 18;
    // ★手前を暗くする。ヘッドライトは地上 0.8m ほどにあって前方を照らすので、
    //   **バンパー直下の路面は光の下に入らず暗いまま**（2026-08-20 ユーザー指摘）。
    //   加えて画像の起点は車両の「中心」なので、最初の 1.7m は車体の下にある。
    //   立ち上がりは 0.3（≒4.5m 先）に置く。
    const grad = ctx.createLinearGradient(0, originY, 0, 0);
    grad.addColorStop(0.0, "rgba(255,244,214,0.0)");
    grad.addColorStop(0.16, "rgba(255,244,214,0.04)");
    grad.addColorStop(0.30, "rgba(255,243,210,0.88)");  // ここが一番明るい
    grad.addColorStop(0.52, "rgba(255,241,205,0.60)");
    grad.addColorStop(0.78, "rgba(255,238,198,0.22)");
    grad.addColorStop(1.0, "rgba(255,236,190,0.0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(originX - 10, originY);
    ctx.lineTo(BEAM_PX / 2 + sideSign * 150, 6);
    ctx.lineTo(BEAM_PX / 2 - sideSign * 40, 6);
    ctx.lineTo(originX + 10, originY);
    ctx.closePath();
    ctx.fill();
  }
  return ctx.getImageData(0, 0, BEAM_PX, BEAM_PX);
}

/** 画像の見かけ大きさを「地面での実寸」に合わせる。
 *  symbol は画面ピクセル基準なので、ズームに合わせて icon-size を変える必要がある。 */
function beamSizeExpression(lat: number) {
  const metersPerPixelAt = (z: number) =>
    (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, z);
  const sizeAt = (z: number) => (BEAM_LENGTH_M / BEAM_PX) / metersPerPixelAt(z);
  return [
    "interpolate", ["exponential", 2], ["zoom"],
    14, sizeAt(14),
    20, sizeAt(20),
  ] as unknown as mapboxgl.ExpressionSpecification;
}

/** Mapbox の model レイヤー。地図画面と同じ paint 設定で並べる。 */
function MapCanvas({ lightPreset }: { lightPreset: "day" | "night" }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const visible = useNearViewport(hostRef);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !MAPBOX_TOKEN || !visible) return;
    mapboxgl.accessToken = MAPBOX_TOKEN;
    const map = new mapboxgl.Map({
      container: host,
      style: "mapbox://styles/mapbox/standard",
      // ★建物の軒下だと車が埋まって見えないので、開けた広い通り（御池通）に置く
      center: [135.7683, 35.0108],
      zoom: 19.2,
      pitch: 55,
      bearing: 12,
      attributionControl: false,
    });

    // 開発プレビュー用に地図インスタンスを公開する（コンソールから調べるため）
    (window as unknown as { __previewMaps?: Record<string, mapboxgl.Map> }).__previewMaps = {
      ...(window as unknown as { __previewMaps?: Record<string, mapboxgl.Map> }).__previewMaps,
      [lightPreset]: map,
    };

    map.on("style.load", () => {
      map.setConfigProperty("basemap", "lightPreset", lightPreset);

      map.addModel("keivan_tinted", MODEL_TINTED);
      map.addModel("keivan_fixed", MODEL_FIXED);

      // ヘッドライト光（夜だけ）。車両より先に足して下に敷く
      if (lightPreset === "night") {
        map.addImage("headlight-beam", makeBeamImage(), { pixelRatio: 1 });
        map.addSource("headlights", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: VEHICLES.map((v, i) => ({
              type: "Feature" as const,
              id: i,
              properties: { rotation: v.rotation },
              geometry: {
                type: "Point" as const,
                coordinates: [135.7683 + v.dx, 35.0108 + v.dy],
              },
            })),
          },
        });
        map.addLayer({
          id: "headlight-pool",
          type: "symbol",
          source: "headlights",
          slot: "middle",
          layout: {
            "icon-image": "headlight-beam",
            "icon-size": beamSizeExpression(35.0108),
            // 画像は上向きに描いてあるので、車の向きへ回す
            "icon-rotate": ["+", ["get", "rotation"], HEADLIGHT_HEADING_OFFSET],
            "icon-rotation-alignment": "map",
            "icon-pitch-alignment": "map",
            "icon-anchor": "bottom",
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
          },
          paint: {
            // ★これが無いと夜の照明で沈んで「影」に見える（fill と同じ罠）
            "icon-emissive-strength": 1.0,
            "icon-opacity": 1.0,
          },
        } as mapboxgl.LayerSpecification);
      }

      map.addSource("vehicles", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          // 実際の運用と同じく、車両ごとに色と向きを持たせる
          features: VEHICLES.map((v, i) => ({
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
      // 1枚目: 車体だけ。ここに model-color が掛かる
      map.addLayer({
        id: "vehicles-3d",
        type: "model",
        source: "vehicles",
        layout: { "model-id": "keivan_tinted" },
        paint: {
          "model-rotation": ["get", "rotation"],
          "model-color": ["get", "color"],
          "model-color-mix-intensity": 0.75,  // 車体だけなので強めに掛けてよい
          "model-emissive-strength": 1,
          // ★実寸（等倍）だと地図の縮尺に対して小さすぎ、引くと消える。
          //   参考画像の車が大きいのは**実物より誇張して描いている**ため（Googleマップも同様）。
          //   ズーム1段ごとに半分にすると、画面上の見かけの大きさが一定になる。
          "model-scale": MODEL_SCALE,
        },
      });
      // 2枚目: 窓・タイヤ・灯火。**model-color を指定しない**ので色が変わらない
      map.addLayer({
        id: "vehicles-3d-fixed",
        type: "model",
        source: "vehicles",
        layout: { "model-id": "keivan_fixed" },
        paint: {
          "model-rotation": ["get", "rotation"],
          "model-emissive-strength": 1,
          // ★実寸（等倍）だと地図の縮尺に対して小さすぎ、引くと消える。
          //   参考画像の車が大きいのは**実物より誇張して描いている**ため（Googleマップも同様）。
          //   ズーム1段ごとに半分にすると、画面上の見かけの大きさが一定になる。
          "model-scale": MODEL_SCALE,
        },
      });
    });

    return () => map.remove();
  }, [lightPreset, visible]);

  if (!MAPBOX_TOKEN) {
    return (
      <div className="flex h-[320px] items-center justify-center rounded-lg bg-slate-100 text-sm text-slate-500">
        NEXT_PUBLIC_MAPBOX_TOKEN が未設定のため地図は表示できません
      </div>
    );
  }
  return <div ref={hostRef} className="h-[320px] w-full overflow-hidden rounded-lg" />;
}

/**
 * 地図は**1枚だけ**置いて昼夜を切り替える。
 *
 * ★同じ Standard スタイルの Map を2つ並べると、片方の basemap フラグメントが
 *   `loaded: false` のまま止まり、タイルも車両も出ない（2026-08-20 実測。
 *   `map.style.fragments` を見て確定した）。querySourceFeatures は値を返すので
 *   「描画されているのに見えない」という紛らわしい症状になる。
 */
function MapPanel() {
  const [preset, setPreset] = useState<"day" | "night">("day");
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 lg:col-span-2">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">地図</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Mapbox model レイヤー。車体だけに model-color が掛かるよう2枚重ねている
          </p>
        </div>
        <div className="flex shrink-0 gap-1 rounded-lg bg-slate-100 p-1">
          {([
            ["day", "昼"],
            ["night", "夜"],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setPreset(key)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                preset === key ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <MapCanvas lightPreset={preset} />
    </section>
  );
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
  const [stats, setStats] = useState<{ triangles: number; meshes: number } | null>(null);
  const handleStats = useCallback(
    (s: { triangles: number; meshes: number }) => setStats(s),
    [],
  );
  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-6xl">
        <h1 className="text-xl font-bold text-slate-900">車両モデルのプレビュー</h1>
        <p className="mt-1 text-sm text-slate-600">
          軽バン。正本は
          <code className="mx-1 rounded bg-slate-200 px-1 py-0.5 text-xs">
            scripts/blender-mcp/models/keivan.py
          </code>
          {/* ★数値は読み込んだ glb から実測する。直書きすると必ず古くなる */}
          {stats
            ? `／ 読み込んだモデル: ${stats.triangles.toLocaleString()} 三角形・${stats.meshes} プリミティブ`
            : "／ 読み込み中…"}
        </p>

        <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Panel title="昼" note="詳細画面の想定。高い太陽＋明るい環境光">
            <VehicleCanvas mode="day" onStats={handleStats} />
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

          <MapPanel />
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {VEHICLE_MODELS.map((v) => (
            <Panel key={v.key} title={v.label} note={v.note}>
              <VehicleCanvas mode="day" autoRotate url={`${v.url}?t=${Date.now()}`} height={300} />
            </Panel>
          ))}
        </div>

        <h2 className="mt-8 text-sm font-semibold text-slate-900">
          アクティ（平滑化 → 平面統合 → 車輪を円柱に差し替え）
        </h2>
        <p className="mb-3 mt-0.5 text-xs text-slate-500">
          平滑化は行わない（リア窓の枠を溶かしていた犯人だったため）。しきい値を上げるほど
          平面が大胆に統合されるが、稜線にはシャープの印を付けてあるので越えない。
          塗り分けは未実施なので全面が白。
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {PLANAR_VARIANTS.map((v) => (
            <Panel key={v.angle} title={`しきい値 ${v.angle}度`} note={`${v.tris} 三角形 / ${v.size}`}>
              <VehicleCanvas mode="day" autoRotate url={`${v.url}?t=${Date.now()}`} height={280} />
            </Panel>
          ))}
        </div>

        <h2 className="mt-8 text-sm font-semibold text-slate-900">
          アクティ（ローポリ表現・原本テクスチャ保持）
        </h2>
        <p className="mb-3 mt-0.5 text-xs text-slate-500">
          外形は18度で平面統合し、12度を超える折れで法線を分けて面を残す。窓・ライト・
          グリルは面単位に塗り直さず、1024pxへ縮小した原本テクスチャで輪郭を保つ候補。
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {LOWPOLY_TEXTURED_MODELS.map((model) => (
            <Panel
              key={model.key}
              title={model.title}
              note={`${model.tris} 三角形 / ${model.size}`}
            >
              <VehicleCanvas
                mode="day"
                autoRotate
                url={`${model.url}?t=${Date.now()}`}
                height={360}
              />
            </Panel>
          ))}
        </div>

        <h3 className="mt-5 text-xs font-semibold text-slate-800">候補B・車体色マスク試作</h3>
        <div className="mt-2 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { label: "白", color: null },
            { label: "青", color: "#2563eb" },
            { label: "赤", color: "#dc2626" },
            { label: "黒", color: "#111827" },
          ].map((item) => (
            <Panel key={item.label} title={item.label}>
              <VehicleCanvas
                mode="day"
                bodyColor={item.color}
                url={`/models/acty2_lowpoly.glb?t=${Date.now()}`}
                height={210}
              />
            </Panel>
          ))}
        </div>

        <h2 className="mt-8 text-sm font-semibold text-slate-900">
          テクスチャ色で自動塗り分けした版
        </h2>
        <p className="mb-3 mt-0.5 text-xs text-slate-500">
          生成モデルのテクスチャには塗り分けが焼かれているので、面の UV で色を引いて
          車体・窓・灯火・黒物へ振り分けている。手作業は要らない。地図用（右端）だけは
          窓枠とグリルを車体色に倒してある（粗く減面すると細い黒い傷として散るため）。
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          {TEXTURED_VARIANTS.map((v) => (
            <Panel
              key={v.url}
              title={v.note ?? `しきい値 ${v.angle}度`}
              note={`${v.tris} 三角形 / ${v.size}`}
            >
              <VehicleCanvas mode="day" autoRotate url={`${v.url}?t=${Date.now()}`} height={280} />
            </Panel>
          ))}
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
