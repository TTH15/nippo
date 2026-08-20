// glb の三角形数・頂点数・ファイルサイズを一覧する（測定用・使い捨て）
import { readFileSync, statSync } from "node:fs";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

for (const path of process.argv.slice(2)) {
  try {
    const doc = await io.read(path);
    let tris = 0;
    let verts = 0;
    let prims = 0;
    const mats = new Set();
    for (const mesh of doc.getRoot().listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        prims++;
        const idx = prim.getIndices();
        const pos = prim.getAttribute("POSITION");
        tris += (idx ? idx.getCount() : pos.getCount()) / 3;
        verts += pos.getCount();
        const m = prim.getMaterial();
        if (m) mats.add(m.getName() || "(無名)");
      }
    }
    const kb = (statSync(path).size / 1024).toFixed(0);
    console.log(
      `${path.split("/").pop().padEnd(24)} ${String(Math.round(tris)).padStart(8)}三角形 ` +
        `${String(verts).padStart(8)}頂点 ${String(prims).padStart(3)}prim ${String(kb).padStart(6)}KB ` +
        `${(statSync(path).size / tris).toFixed(0)}B/三角形  mat=[${[...mats].join(", ")}]`,
    );
  } catch (e) {
    console.log(`${path}: 読めず (${e.message})`);
  }
}
