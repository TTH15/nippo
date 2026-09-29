import * as T from "three";
import atlas from "./assets/plate-textures.json";
import type { previewVehicle } from "../vehicle";

type Plate = Pick<typeof previewVehicle, "number_prefix" | "number_class" | "number_hiragana" | "number_numeric">;
// Webの既存SVGレンダラーから出力したRGBAを復元。実行時のDOM・外部通信なし。
export function createPlateTexture(plate: Plate) {
  const key = `${plate.number_prefix} ${plate.number_class} ${plate.number_hiragana} ${plate.number_numeric}`;
  const entry = (atlas.plates as Record<string, { width: number; height: number; runs: number[] }>)[key];
  if (!entry) throw new Error(`Preview plate texture missing: ${key}`);
  const pixels = new Uint8Array(entry.width * entry.height * 4);
  let offset = 0;
  for (let i = 0; i < entry.runs.length; i += 2) {
    const value = entry.runs[i + 1];
    for (let n = 0; n < entry.runs[i]; n++) {
      const row = Math.floor(offset / entry.width), x = offset % entry.width;
      const target = ((entry.height - 1 - row) * entry.width + x) * 4;
      pixels[target] = value >>> 24; pixels[target + 1] = (value >>> 16) & 255;
      pixels[target + 2] = (value >>> 8) & 255; pixels[target + 3] = value & 255; offset++;
    }
  }
  const texture = new T.DataTexture(pixels, entry.width, entry.height, T.RGBAFormat);
  texture.colorSpace = T.SRGBColorSpace; texture.minFilter = T.LinearMipmapLinearFilter;
  texture.magFilter = T.LinearFilter; texture.generateMipmaps = true; texture.needsUpdate = true;
  texture.name = key;
  return texture;
}

export function addVehiclePlates(parent: T.Object3D, plate: Plate) {
  const texture = createPlateTexture(plate);
  const material = new T.MeshBasicMaterial({ map: texture, toneMapped: false });
  material.name = "Preview Plate Lettering";
  // 原本の前後プレートに重ねる。車体groupへ付けてサスペンションの動きに追従。
  for (const [side, x, y, z, angle] of [
    ["front", -.245, .355, 1.717, 0], ["rear", 0, .354, -1.717, Math.PI],
  ] as const) {
    const mesh = new T.Mesh(new T.PlaneGeometry(.33, .165), material);
    mesh.name = `plate-${side}`; mesh.position.set(x, y, z); mesh.rotation.y = angle;
    mesh.userData.plate = texture.name; parent.add(mesh);
  }
}
