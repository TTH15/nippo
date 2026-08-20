import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";

// ============================================================
// glb を読むローダー（2026-08-20）。
//
// 詳細ページ用のモデルは **Draco 圧縮**してある（4.02MB → 0.69MB）。
// ★地図（Mapbox の model レイヤー）は Draco を読めないので、地図用の
//   tinted / fixed は非圧縮のまま出している。圧縮を掛けてよいのはこちらだけ。
//
// デコーダは `public/draco/`（three 同梱のものをコピー）。CDN は使わない。
// ============================================================

// ワーカーを毎回作らないよう使い回す
let draco: DRACOLoader | null = null;

export function createGltfLoader(): GLTFLoader {
  if (!draco) {
    draco = new DRACOLoader();
    draco.setDecoderPath("/draco/");
  }
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  return loader;
}
