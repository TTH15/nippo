// Webで車両GLBへ番号を焼く既存実装をそのまま使用。SVG字形・字間・配色を複製しない。
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';
const root = process.cwd(), cache = path.join(root, 'node_modules/.cache/hakotora-plate');
await mkdir(cache, {recursive:true});
await build({entryPoints:['apps/web/src/server/vehicles/plateModel.ts'],bundle:true,platform:'node',format:'cjs',packages:'external',outfile:path.join(cache,'render.cjs'),alias:{'@':path.join(root,'apps/web/src')}});
await build({entryPoints:['apps/mobile/ui-preview/vehicle.ts'],bundle:true,platform:'node',format:'cjs',outfile:path.join(cache,'fixture.cjs')});
const require=createRequire(import.meta.url);
const {renderPlateTexture}=require(path.join(cache,'render.cjs'));
const {previewVehicle,previewTrafficVehicle}=require(path.join(cache,'fixture.cjs'));
process.chdir(path.join(root,'apps/web'));
const plates={};
for(const v of [previewVehicle,previewTrafficVehicle]) {
  const key=[v.number_prefix,v.number_class,v.number_hiragana,v.number_numeric].join(' ');
  const png=await renderPlateTexture({region:v.number_prefix,classification:v.number_class,hiragana:v.number_hiragana,serial:v.number_numeric});
  const {data,info}=await sharp(png).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const runs=[];let last=-1,count=0;
  for(let i=0;i<data.length;i+=4){const value=(data[i]*16777216+data[i+1]*65536+data[i+2]*256+data[i+3]);if(value===last)count++;else {if(count)runs.push(count,last);last=value;count=1;}}
  runs.push(count,last);plates[key]={width:info.width,height:info.height,runs};
  await writeFile(path.join(root,'apps/mobile/ui-preview/scene/assets',`plate-${v.number_numeric}.png`),png);
}
const source='apps/web/src/server/vehicles/plateModel.ts';
await writeFile(path.join(root,'apps/mobile/ui-preview/scene/assets/plate-textures.json'),JSON.stringify({source,sourceSha256:createHash('sha256').update(await readFile(path.join(root,source))).digest('hex'),plates})+'\n');
console.log(Object.keys(plates));
