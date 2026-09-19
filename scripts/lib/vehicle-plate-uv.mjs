// 地図・詳細プレビュー・番号GLBで同じ前後プレートUVを使う。座標と形は変更しない。
import { Accessor } from "@gltf-transform/core";
export function applyVehiclePlateUV(doc) {
  for (const mesh of doc.getRoot().listMeshes()) for (const primitive of mesh.listPrimitives()) {
    if (!/plate/i.test(primitive.getMaterial()?.getName() ?? "")) continue;
    const position = primitive.getAttribute("POSITION");
    const sideBounds = new Map();
    const point = [0, 0, 0];
    for (let i = 0; i < position.getCount(); i += 1) {
      position.getElement(i, point);
      const side = point[0] >= 0 ? 1 : -1;
      const bounds = sideBounds.get(side) ?? { minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
      bounds.minY = Math.min(bounds.minY, point[1]);
      bounds.maxY = Math.max(bounds.maxY, point[1]);
      bounds.minZ = Math.min(bounds.minZ, point[2]);
      bounds.maxZ = Math.max(bounds.maxZ, point[2]);
      sideBounds.set(side, bounds);
    }
    const uv = new Float32Array(position.getCount() * 2);
    for (let i = 0; i < position.getCount(); i += 1) {
      position.getElement(i, point);
      const side = point[0] >= 0 ? 1 : -1;
      const bounds = sideBounds.get(side);
      const across = (point[2] - bounds.minZ) / Math.max(1e-6, bounds.maxZ - bounds.minZ);
      uv[i * 2] = side > 0 ? 1 - across : across;
      uv[i * 2 + 1] = (bounds.maxY - point[1]) / Math.max(1e-6, bounds.maxY - bounds.minY);
    }
    primitive.setAttribute("TEXCOORD_0", doc.createAccessor("plate-uv").setType(Accessor.Type.VEC2).setArray(uv));
  }
}
