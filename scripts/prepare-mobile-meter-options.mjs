// 中央1眼・右燃料の線量比較。共通の形を保ち、固定表示だけを段階的に加える。
import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';

const assetDir = 'apps/mobile/src/capture/assets';
const panel = '<path d="M30 258 V148 Q30 82 98 60 Q179 29 301 29 Q439 29 507 60 Q570 84 570 151 V258 Q570 304 525 304 H75 Q30 304 30 258 Z" stroke-opacity=".82" stroke-width="2.6"/>';
const main = '<path d="M166 264 A153 153 0 1 1 454 264" stroke-opacity=".62" stroke-width="2.2"/>';
const odometer = '<rect x="254" y="257" width="122" height="29" rx="5" stroke-opacity=".68" stroke-width="2"/>';
const fuel = '<path d="M499 145 L539 117 Q561 156 552 190 L538 214 L500 190" stroke-opacity=".64" stroke-width="2.2"/>';
const inner = '<path d="M184 251 A134 134 0 1 1 436 251" stroke-opacity=".36" stroke-width="1.5"/><path d="M504 152 L535 133 Q550 158 545 182 L534 199 L505 183" stroke-opacity=".36" stroke-width="1.4"/><path d="M246 251 Q250 247 257 247 H373 Q380 247 384 251" stroke-opacity=".32" stroke-width="1.4"/>';
const text = '<g fill="white" stroke="none" fill-opacity=".62" font-family="Arial, sans-serif"><text x="310" y="156" text-anchor="middle" font-size="18">km/h</text><text x="509" y="130" font-size="14">F</text><text x="509" y="219" font-size="14">E</text></g>';
const speedLabels = [
  [207, 244, '0'], [215, 160, '20'], [259, 108, '40'], [310, 95, '60'],
  [361, 108, '80'], [405, 160, '100'], [413, 244, '120'],
].map(([x, y, value]) => `<text x="${x}" y="${y}" text-anchor="middle" font-size="17">${value}</text>`).join('');
const scale = `<g fill="white" stroke="none" fill-opacity=".58" font-family="Arial, sans-serif" font-weight="600">${speedLabels}</g>`;
const point = (radius, angle) => {
  const rad = angle * Math.PI / 180;
  return [+(310 + Math.cos(rad) * radius).toFixed(1), +(205 + Math.sin(rad) * radius).toFixed(1)];
};
const tick = (angle, innerRadius, outerRadius) => {
  const a = point(innerRadius, angle), b = point(outerRadius, angle);
  return `M${a[0]} ${a[1]}L${b[0]} ${b[1]}`;
};
const majorTicks = `<path d="${Array.from({ length: 13 }, (_, i) => tick(160 + i * 18.333, 126, 136)).join(' ')}" stroke-opacity=".64" stroke-width="2.4"/>`;
const minorTicks = `<path d="${Array.from({ length: 24 }, (_, i) => tick(166.111 + i * 9.1665, 132, 137)).join(' ')}" stroke-opacity=".42" stroke-width="1.5"/>`;
const detail = '<path d="M38 250 V150 Q38 90 100 69 Q180 37 301 37 Q438 37 504 68 Q562 90 562 151 V251" stroke-opacity=".29" stroke-width="1.4"/><path d="M504 145 L512 139 M505 183 L514 190 M531 121 L535 135 M538 198 L543 208" stroke-opacity=".54" stroke-width="1.6"/><g fill="white" stroke="none" fill-opacity=".46" font-family="Arial, sans-serif" font-size="14"><text x="116" y="115">P</text><text x="116" y="139">R</text><text x="116" y="163">N</text><text x="116" y="187">D</text><text x="116" y="211">2</text><text x="116" y="235">L</text></g>';
const options = [
  panel + main + odometer + fuel + inner,
  panel + main + odometer + fuel + inner + text,
  panel + main + odometer + fuel + inner + text + majorTicks + scale,
  panel + main + odometer + fuel + inner + text + majorTicks + minorTicks + scale + detail,
];
for (const [index, content] of options.entries()) {
  const name = `meter-center-right-option-${index + 2}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="340" viewBox="0 0 600 340" fill="none" stroke="white" stroke-linecap="round" stroke-linejoin="round">${content}</svg>`;
  await writeFile(`${assetDir}/${name}.svg`, svg);
  await sharp(Buffer.from(svg)).resize({ width: 1200 }).png().toFile(`${assetDir}/${name}.png`);
}
