// 既存Web原本から再生成可能なモバイル用派生資産を作る。原本は変更しない。
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as T from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
// UUIDを固定し、同じ入力から同じ出力を得る（このビルドスクリプト内だけ）。
let seed = 170923; Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const source = 'apps/web/public/models/kei-every-da17v-405b534e.glb';
const out = 'apps/mobile/ui-preview/scene/assets';
const bytes = await readFile(source);
const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
gltf.scene.updateMatrixWorld(true);
const box = new T.Box3().setFromObject(gltf.scene), center = box.getCenter(new T.Vector3());
console.log('Source bounds', box.min.toArray(), box.max.toArray());
const normalization = new T.Matrix4().makeRotationY(-Math.PI / 2).multiply(new T.Matrix4().makeTranslation(-center.x, -box.min.y, -center.z));
const root = new T.Group(); root.name = 'every-da17v-mobile';
const wheelParts = ['Tire', 'Steel_Rim', 'Hub', ...Array.from({ length: 4 }, (_, i) => `Lug_${i}`), ...Array.from({ length: 12 }, (_, i) => `DA17_Wheel_Vent_${i}`)];
const wheels = ['Left_Front', 'Right_Front', 'Left_Rear', 'Right_Rear'].map(prefix => {
  const names = wheelParts.map(suffix => `${prefix}_${suffix}`);
  for (const name of names) if (!gltf.scene.getObjectByName(name)) throw new Error(`Missing wheel part: ${name}`);
  const tire = gltf.scene.getObjectByName(`${prefix}_Tire`);
  const pivot = new T.Box3().setFromObject(tire).getCenter(new T.Vector3()).applyMatrix4(normalization);
  const group = new T.Group(); group.name = `wheel-${prefix.toLowerCase().replace('_', '-')}`; group.position.copy(pivot); root.add(group);
  return { names, group, pivot };
});
const body = new T.Group(); body.name = 'body'; root.add(body);
const batches = new Map(); let sourceTriangles = 0;
gltf.scene.traverse(node => {
  if (!node.isMesh) return;
  if (Array.isArray(node.material)) throw new Error('Unexpected multi-material mesh');
  sourceTriangles += (node.geometry.index?.count ?? node.geometry.attributes.position.count) / 3;
  const wheel = wheels.find(w => w.names.includes(node.name));
  const group = wheel?.group ?? body;
  const geometry = node.geometry.index ? node.geometry.toNonIndexed() : node.geometry.clone();
  geometry.applyMatrix4(node.matrixWorld).applyMatrix4(normalization);
  if (wheel) geometry.translate(-wheel.pivot.x, -wheel.pivot.y, -wheel.pivot.z);
  for (const key of Object.keys(geometry.attributes)) if (!['position', 'normal'].includes(key)) geometry.deleteAttribute(key);
  const key = `${group.name}:${node.material.uuid}`;
  if (!batches.has(key)) batches.set(key, { group, material: node.material, geometries: [] });
  batches.get(key).geometries.push(geometry);
});
for (const batch of batches.values()) {
  const merged = mergeGeometries(batch.geometries); const geometry = mergeVertices(merged, 1e-5);
  const mesh = new T.Mesh(geometry, batch.material.clone()); mesh.name = `${batch.group.name}:${batch.material.name}`;
  batch.group.add(mesh); merged.dispose(); batch.geometries.forEach(g => g.dispose());
}
let triangles = 0;root.traverse(n => {if(n.isMesh) triangles += (n.geometry.index?.count ?? n.geometry.attributes.position.count)/3;});
if (triangles !== sourceTriangles) throw new Error('Triangle count changed');
// NodeにはFileReaderがない。画像を持たないGLBのbinary出力だけを実装。
globalThis.FileReader = class { readAsArrayBuffer(blob) { blob.arrayBuffer().then(buffer => { this.result = buffer; this.onloadend?.(); }); } };
const binary = Buffer.from(await new GLTFExporter().parseAsync(root, { binary: true }));
const json = JSON.stringify(root.toJSON());
await mkdir(out, { recursive: true });
await writeFile(`${out}/every-da17v.glb`, binary);
await writeFile(`${out}/every-da17v.scene.json`, json);
await writeFile(`${out}/manifest.json`, JSON.stringify({ version: 1, source, sourceSha256: createHash('sha256').update(bytes).digest('hex'),
  glbSha256: createHash('sha256').update(binary).digest('hex'), triangles, meshes: batches.size, sourceMeshes: 317,
  bytes: { source: bytes.length, glb: binary.length, sceneJson: Buffer.byteLength(json) },
  transform: { translation: [-center.x, -box.min.y, -center.z], rotationY: -Math.PI / 2, axis: 'Y-up, front +Z (source front +X)' , dimensions: box.getSize(new T.Vector3()).toArray() },
  wheels: wheels.map(w => ({ name: w.group.name, pivot: w.pivot.toArray(), axle: 'X', members: w.names })),
  notes: ['No source geometry removed. Grouped by material and wheel; wheelhouse/inner arch remain on body.', 'Texture-free Three ObjectLoader JSON accompanies GLB to avoid browser-only loaders on native.', 'Blank base plates; runtime adds front/rear lettering from the shared preview vehicle fixture. Not production vehicle data.'] }, null, 2)+'\n');
console.log({ triangles, meshes: batches.size, glbBytes: binary.length, jsonBytes: Buffer.byteLength(json) });
