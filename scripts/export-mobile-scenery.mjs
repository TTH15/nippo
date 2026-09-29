// ランタイムと同じ手続き的背景から、制作・再利用用のGLBキットを出す。
import { build } from 'esbuild';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import * as T from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
let seed = 230917; Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
globalThis.FileReader = class { readAsArrayBuffer(blob) { blob.arrayBuffer().then(buffer => { this.result = buffer; this.onloadend?.(); }); } };
const temp = await mkdtemp(join(tmpdir(), 'hakotora-scenery-'));
try {
  const file = join(temp, 'scene.mjs');
  await build({ entryPoints: ['apps/mobile/ui-preview/scene/create-scene.ts'], bundle: true, platform: 'node', format: 'esm', outfile: file });
  const { createDrivingScene } = await import(pathToFileURL(file).href);
  const world = createDrivingScene('off');
  const kit = new T.Group(); kit.name = 'hakotora-low-poly-scenery';
  const entries = [];
  // 配置前のgeometryを取り出す。キットには各モデルを1点ずつ、原点で格納する。
  for (const name of ['tree-round', 'tree-pine', 'building-low', 'building-mid', 'building-tall', 'cloud-0', 'cloud-1', 'cloud-2', 'bench']) {
    const source = world.scene.getObjectByName(name);
    if (!source?.isMesh) throw new Error(`Missing prefab ${name}`);
    const material = new T.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, metalness: 0 });
    const mesh = new T.Mesh(source.geometry.clone(), material); mesh.name = name; kit.add(mesh);
    entries.push({ name, triangles: (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3 });
  }
  const road = new T.Mesh(new T.BoxGeometry(6.2, .02, 6), new T.MeshStandardMaterial({ color: '#94A8BA', roughness: 1 }));road.name = 'road-tile';kit.add(road);entries.push({name:road.name,triangles:12});
  const sidewalk = new T.Mesh(new T.BoxGeometry(.5,.2,6),new T.MeshStandardMaterial({color:'#D5DFDC',roughness:1}));sidewalk.name='sidewalk-tile';kit.add(sidewalk);entries.push({name:sidewalk.name,triangles:12});
  const bytes = Buffer.from(await new GLTFExporter().parseAsync(kit, { binary: true }));
  const out='apps/mobile/ui-preview/scene/assets'; await writeFile(`${out}/scenery-kit.glb`, bytes);
  await writeFile(`${out}/scenery-manifest.json`, JSON.stringify({version:1,generator:'scripts/export-mobile-scenery.mjs',source:'apps/mobile/ui-preview/scene/create-scene.ts',sourceSha256:createHash('sha256').update(await readFile('apps/mobile/ui-preview/scene/create-scene.ts')).digest('hex'),sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,units:'meters, Y-up; prefab nodes overlap at origin, select individual nodes for placement',models:entries},null,2)+'\n');
  world.dispose();kit.traverse(n=>{if(n.isMesh){n.geometry.dispose();n.material.dispose()}});console.log({bytes:bytes.length,models:entries});
} finally { await rm(temp,{recursive:true,force:true}); }
