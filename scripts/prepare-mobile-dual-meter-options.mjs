// 左右2眼・中央燃料の描き込み比較。参考写真の配置を使い、変動する針と走行距離は描かない。
import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';

const assetDir = 'apps/mobile/src/capture/assets';
const panel = '<path d="M27 263 V150 Q27 62 145 39 Q300 13 455 39 Q573 62 573 150 V263 Q573 306 530 306 H70 Q27 306 27 263 Z" stroke-opacity=".82" stroke-width="2.6"/>';
const gauges = '<circle cx="174" cy="164" r="116" stroke-opacity=".61" stroke-width="2.2"/><circle cx="438" cy="164" r="116" stroke-opacity=".61" stroke-width="2.2"/>';
const fuel = '<circle cx="307" cy="252" r="40" stroke-opacity=".62" stroke-width="2"/>';
const odometer = '<rect x="400" y="225" width="100" height="27" rx="4" stroke-opacity=".68" stroke-width="2"/>';
const inner = '<path d="M78 208 A106 106 0 1 1 270 208 M342 208 A106 106 0 1 1 534 208" stroke-opacity=".33" stroke-width="1.4"/>';
const text = '<g fill="white" stroke="none" fill-opacity=".6" font-family="Arial, sans-serif"><text x="174" y="137" text-anchor="middle" font-size="14">x1000r/min</text><text x="438" y="137" text-anchor="middle" font-size="17">km/h</text><text x="278" y="269" text-anchor="middle" font-size="13">E</text><text x="336" y="269" text-anchor="middle" font-size="13">F</text></g>';
const point = (cx, angle, radius) => {
  const rad = angle * Math.PI / 180;
  return [+(cx + Math.cos(rad) * radius).toFixed(1), +(164 + Math.sin(rad) * radius).toFixed(1)];
};
const labels = (cx, values, start, step) => values.map((value, index) => {
  const [x, y] = point(cx, start + step * index, 85);
  return `<text x="${x}" y="${y + 5}" text-anchor="middle" font-size="15">${value}</text>`;
}).join('');
const scale = `<g fill="white" stroke="none" fill-opacity=".6" font-family="Arial, sans-serif" font-weight="600">${labels(174, ['0','1','2','3','4','5','6','7','8','9'], 135, 21)}${labels(438, ['0','20','40','60','80','100','120','140'], 135, 35)}</g>`;
const tick = (cx, angle, from, to) => {
  const a = point(cx, angle, from), b = point(cx, angle, to);
  return `M${a[0]} ${a[1]}L${b[0]} ${b[1]}`;
};
const majorTicks = `<path d="${[
  ...Array.from({ length: 10 }, (_, i) => tick(174, 135 + i * 21, 99, 111)),
  ...Array.from({ length: 8 }, (_, i) => tick(438, 135 + i * 35, 99, 111)),
].join(' ')}" stroke-opacity=".6" stroke-width="2.1"/>`;
const minorTicks = `<path d="${[
  ...Array.from({ length: 27 }, (_, i) => tick(174, 140.25 + i * 7, 106, 112)),
  ...Array.from({ length: 28 }, (_, i) => tick(438, 139.375 + i * 8.75, 106, 112)),
].join(' ')}" stroke-opacity=".41" stroke-width="1.3"/>`;
const detail = '<path d="M34 264 V150 Q34 68 147 46 Q300 21 453 46 Q566 68 566 150 V264" stroke-opacity=".28" stroke-width="1.4"/><path d="M278 233 Q307 208 336 233" stroke-opacity=".4" stroke-width="1.3"/><rect x="290" y="64" width="64" height="14" rx="6" stroke-opacity=".32" stroke-width="1.2"/><rect x="304" y="88" width="48" height="14" rx="6" stroke-opacity=".32" stroke-width="1.2"/><g fill="white" stroke="none" fill-opacity=".46" font-family="Arial, sans-serif" font-size="13"><text x="249" y="129">P</text><text x="249" y="151">R</text><text x="249" y="173">N</text><text x="249" y="195">D</text><text x="249" y="217">2</text></g>';
const options = [
  panel + gauges + fuel + odometer + inner,
  panel + gauges + fuel + odometer + inner + text,
  panel + gauges + fuel + odometer + inner + text + majorTicks + scale,
  panel + gauges + fuel + odometer + inner + text + majorTicks + minorTicks + scale + detail,
];
for (const [index, content] of options.entries()) {
  const name = `meter-dual-center-fuel-option-${index + 2}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="340" viewBox="0 0 600 340" fill="none" stroke="white" stroke-linecap="round" stroke-linejoin="round">${content}</svg>`;
  await writeFile(`${assetDir}/${name}.svg`, svg);
  await sharp(Buffer.from(svg)).resize({ width: 1200 }).png().toFile(`${assetDir}/${name}.png`);
}
