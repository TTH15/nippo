"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { createGltfLoader } from "@/lib/three/gltf-loader";

// ============================================================
// 車両3Dモデルのプレビュー（2026-08-10）。
// 車両編集画面で「その車がどう見えるか」をその場で確認するための小さなビューア。
//
// 地図と同じ glb をそのまま読む（実寸・原点=底面中心・フラット・プレートは別マテリアル）。
// 車体色は `plate` 以外のマテリアルにだけ効かせる — プレートは黒ナンバーのままにしたいため。
// ============================================================

/** 夜（JST）かどうか。地図のライティング切替と同じ考え方で、時間帯に合わせる。 */
function isNightJST(): boolean {
  const h = Number(
    new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "numeric", hour12: false })
      .formatToParts(new Date())
      .find((p) => p.type === "hour")?.value ?? "12",
  );
  return h >= 18 || h < 5;
}

/** 発光の丸いテクスチャ（中心が明るく外へ向かって減衰）。 */
function makeGlowTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(255,255,255,0.55)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function VehicleModelPreview({
  modelUrl,
  bodyColor,
  className,
  night,
}: {
  modelUrl: string;
  /** #RRGGBB。未指定ならモデル本来の色 */
  bodyColor?: string | null;
  className?: string;
  /** 夜間表示（ライトを灯す）。未指定なら日本時間で判定 */
  night?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const bodyMaterialsRef = useRef<THREE.MeshStandardMaterial[]>([]);
  const lampsRef = useRef<THREE.Sprite[]>([]);
  const nightRef = useRef<boolean>(night ?? isNightJST());
  nightRef.current = night ?? isNightJST();

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // 白飛びを抑えて陰影を残す（既定のままだと明るい面が潰れて「粘土」に見える）
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    host.appendChild(renderer.domElement);

    // 平行光だけだと「粘土」に見えるので、環境マップで面の向きに応じた明暗を作る
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa4b2, 0.8));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(3, 5, 4);
    scene.add(key);

    lampsRef.current = [];
    let raf = 0;
    let disposed = false;
    let model: THREE.Object3D | null = null;
    // ★ぐるぐる回さない。生成モデルはリアの造形が実車と違うことが多く、
    //   回すと必ず粗が見える（2026-08-11 指摘）。**前寄りの斜め45度**で止め、
    //   ゆっくり左右に揺らすだけにする。見たい人はドラッグで回せる。
    const BASE_ANGLE = -Math.PI * 0.28;
    let angle = BASE_ANGLE;
    let userAngle: number | null = null;
    let t = 0;

    const resize = () => {
      const w = host.clientWidth || 240;
      const h = host.clientHeight || 160;
      renderer.setSize(w, h); // updateStyle=true。false だと CSS サイズが付かず**枠からはみ出す**
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);

    createGltfLoader().load(
      modelUrl,
      (gltf) => {
        if (disposed) return;
        model = gltf.scene;
        // 車体マテリアルだけ集める（プレートは黒のまま保つ）
        bodyMaterialsRef.current = [];
        model.traverse((obj) => {
          const mesh = obj as THREE.Mesh;
          if (!mesh.isMesh) return;
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const m of mats) {
            if (m instanceof THREE.MeshStandardMaterial && m.name !== "plate") {
              bodyMaterialsRef.current.push(m);
            }
          }
        });
        applyColor();
        scene.add(model);

        // 接地影。浮いて見えると玩具っぽくなるので、足元に柔らかい影を敷く
        const shadow = new THREE.Mesh(
          new THREE.CircleGeometry(1, 48),
          new THREE.MeshBasicMaterial({
            color: 0x0f172a,
            transparent: true,
            opacity: 0.16,
            depthWrite: false,
          }),
        );
        shadow.rotation.x = -Math.PI / 2;
        scene.add(shadow);

        // 車全体が収まる距離にカメラを置く
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        model.position.sub(center); // 原点まわりで回せるように中心へ寄せる
        // 枠の中に必ず収まる距離。視野角と縦横比の小さい方に合わせる
        const radius = Math.max(size.x, size.y, size.z) * 0.62;
        const fov = (camera.fov * Math.PI) / 180;
        const dist = radius / Math.sin(Math.min(fov, fov * camera.aspect) / 2);
        camera.position.set(0, size.y * 0.55, dist);
        camera.lookAt(0, size.y * 0.35, 0);
        shadow.scale.setScalar(Math.max(size.x, size.z) * 0.42);
        shadow.position.y = -size.y / 2 + 0.01;

        // 夜はライトを灯す。**モデルには手を入れず**、車体の前後端に発光スプライトを置く。
        // どちらが前かは生成モデルからは判定できないので、両端とも電球色にする
        //（赤を前に付けてしまう方が事故なので、確実な側に倒す）。
        const glow = makeGlowTexture();
        const halfLen = size.x / 2;
        const lampY = -size.y / 2 + size.y * 0.28;
        for (const sx of [-1, 1]) {
          for (const sz of [-1, 1]) {
            const sprite = new THREE.Sprite(
              new THREE.SpriteMaterial({
                map: glow,
                color: 0xffd9a0,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
              }),
            );
            sprite.position.set(sx * halfLen * 0.92, lampY, sz * (size.z / 2) * 0.55);
            sprite.scale.setScalar(size.y * 0.5);
            lampsRef.current.push(sprite);
            model!.add(sprite); // 車体と一緒に回るよう子にする
          }
        }
        applyNight();
      },
      undefined,
      (err) => console.error("[VehicleModelPreview] load error", err),
    );

    const applyNight = () => {
      for (const lamp of lampsRef.current) lamp.visible = nightRef.current;
      // 夜は環境光を落として、灯りが際立つようにする
      key.intensity = nightRef.current ? 0.45 : 1.1;
      renderer.toneMappingExposure = nightRef.current ? 0.85 : 1.15;
    };
    applyNightRef.current = applyNight;

    const applyColor = () => {
      const hex = bodyColorRef.current;
      for (const m of bodyMaterialsRef.current) {
        m.color.set(hex && /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : "#eef0f5");
      }
    };
    applyColorRef.current = applyColor;

    // ドラッグで見たい向きに回せる（勝手に一周させない代わりの逃げ道）
    let dragging = false;
    let lastX = 0;
    const onDown = (e: PointerEvent) => {
      dragging = true;
      lastX = e.clientX;
      renderer.domElement.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      userAngle = (userAngle ?? angle) + (e.clientX - lastX) * 0.01;
      lastX = e.clientX;
    };
    const onUp = () => {
      dragging = false;
    };
    renderer.domElement.style.cursor = "grab";
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointermove", onMove);
    renderer.domElement.addEventListener("pointerup", onUp);

    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (model) {
        t += 0.006;
        angle = userAngle ?? BASE_ANGLE + Math.sin(t) * 0.14; // ±8度ほど揺らす
        model.rotation.y = angle;
      }
      renderer.render(scene, camera);
    };
    tick();

    return () => {
      disposed = true;
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointermove", onMove);
      renderer.domElement.removeEventListener("pointerup", onUp);
      cancelAnimationFrame(raf);
      observer.disconnect();
      renderer.dispose();
      host.removeChild(renderer.domElement);
    };
  }, [modelUrl]);

  // 色だけの変更でモデルを読み直さない（読み直すと一瞬消えてちらつく）
  const bodyColorRef = useRef<string | null | undefined>(bodyColor);
  const applyColorRef = useRef<() => void>(() => {});
  const applyNightRef = useRef<() => void>(() => {});
  bodyColorRef.current = bodyColor;
  useEffect(() => {
    applyColorRef.current();
  }, [bodyColor]);
  useEffect(() => {
    applyNightRef.current();
  }, [night]);

  return <div ref={hostRef} className={className} />;
}
