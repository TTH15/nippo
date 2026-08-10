"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

// ============================================================
// 車両3Dモデルのプレビュー（2026-08-10）。
// 車両編集画面で「その車がどう見えるか」をその場で確認するための小さなビューア。
//
// 地図と同じ glb をそのまま読む（実寸・原点=底面中心・フラット・プレートは別マテリアル）。
// 車体色は `plate` 以外のマテリアルにだけ効かせる — プレートは黒ナンバーのままにしたいため。
// ============================================================

export function VehicleModelPreview({
  modelUrl,
  bodyColor,
  className,
}: {
  modelUrl: string;
  /** #RRGGBB。未指定ならモデル本来の色 */
  bodyColor?: string | null;
  className?: string;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const bodyMaterialsRef = useRef<THREE.MeshStandardMaterial[]>([]);

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

    new GLTFLoader().load(
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
      },
      undefined,
      (err) => console.error("[VehicleModelPreview] load error", err),
    );

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
  bodyColorRef.current = bodyColor;
  useEffect(() => {
    applyColorRef.current();
  }, [bodyColor]);

  return <div ref={hostRef} className={className} />;
}
