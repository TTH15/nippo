// 3連丸型の描き込み比較。中央の速度、左の燃料・水温、右の回転計を固定形状だけで描く。
import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';

const assetDir = 'apps/mobile/src/capture/assets';
const panel = '<path d="M20 259 V140 Q20 55 130 32 Q300 8 470 32 Q580 55 580 140 V259 Q580 307 532 307 H68 Q20 307 20 259 Z" stroke-opacity=".8" stroke-width="2.6"/>';
const gauges = '<circle cx="91" cy="165" r="81" stroke-opacity=".57" stroke-width="2"/><circle cx="300" cy="165" r="124" stroke-opacity=".67" stroke-width="2.3"/><circle cx="509" cy="165" r="81" stroke-opacity=".57" stroke-width="2"/>';
const sideArcs = '<path d="M55 195 Q91 175 127 195 M56 135 Q91 109 126 135" stroke-opacity=".47" stroke-width="1.8"/>';
const windows = '<rect x="253" y="122" width="94" height="26" rx="3" stroke-opacity=".6" stroke-width="1.8"/><rect x="253" y="218" width="94" height="26" rx="3" stroke-opacity=".66" stroke-width="1.8"/>';
const inner = '<circle cx="300" cy="165" r="111" stroke-opacity=".32" stroke-width="1.5"/><path d="M454 165 A55 55 0 0 1 564 165 M37 165 A54 54 0 0 1 145 165" stroke-opacity=".28" stroke-width="1.3"/>';
const text = '<g fill="white" stroke="none" fill-opacity=".6" font-family="Arial, sans-serif"><text x="300" y="267" text-anchor="middle" font-size="18">km/h</text><text x="49" y="214" font-size="13">E</text><text x="124" y="214" font-size="13">F</text><text x="49" y="120" font-size="13">C</text><text x="124" y="120" font-size="13">H</text><text x="509" y="211" text-anchor="middle" font-size="13">x1000r/min</text></g>';
const speedValues = [
  [213, 228, '0'], [202, 183, '20'], [224, 133, '40'], [268, 95, '60'],
  [332, 95, '80'], [376, 133, '100'], [398, 183, '120'], [387, 228, '140'],
].map(([x, y, value]) => `<text x="${x}" y="${y}" text-anchor="middle" font-size="16">${value}</text>`).join('');
const scale = `<g fill="white" stroke="none" fill-opacity=".61" font-family="Arial, sans-serif" font-weight="600">${speedValues}</g>`;
const point = (cx, cy, radius, angle) => {
  const radians = angle * Math.PI / 180;
  return [+(cx + Math.cos(radians) * radius).toFixed(1), +(cy + Math.sin(radians) * radius).toFixed(1)];
};
const tick = (cx, cy, angle, from, to) => {
  const a = point(cx, cy, from, angle), b = point(cx, cy, to, angle);
  return `M${a[0]} ${a[1]}L${b[0]} ${b[1]}`;
};
const major = `<path d="${Array.from({ length: 8 }, (_, i) => tick(300, 165, 145 + i * 35.7, 105, 117)).join(' ')}" stroke-opacity=".62" stroke-width="2.5"/>`;
const minor = `<path d="${Array.from({ length: 28 }, (_, i) => tick(300, 165, 149.46 + i * 8.925, 113, 118)).join(' ')}" stroke-opacity=".43" stroke-width="1.3"/>`;
const detail = '<path d="M27 259 V140 Q27 62 132 40 Q300 16 468 40 Q573 62 573 140 V259" stroke-opacity=".28" stroke-width="1.3"/><path d="M53 200 Q91 181 129 200 M54 139 Q91 116 128 139" stroke-opacity=".33" stroke-width="1.2"/><g fill="white" stroke="none" fill-opacity=".43" font-family="Arial, sans-serif" font-size="12"><text x="139" y="125">P</text><text x="139" y="145">R</text><text x="139" y="165">N</text><text x="139" y="185">D</text><text x="139" y="205">2</text><text x="139" y="225">L</text></g>';
const options = [
  panel + gauges + sideArcs + windows + inner,
  panel + gauges + sideArcs + windows + inner + text,
  panel + gauges + sideArcs + windows + inner + text + major + scale,
  panel + gauges + sideArcs + windows + inner + text + major + minor + scale + detail,
];
for (const [index, content] of options.entries()) {
  const name = `meter-triple-center-option-${index + 2}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="340" viewBox="0 0 600 340" fill="none" stroke="white" stroke-linecap="round" stroke-linejoin="round">${content}</svg>`;
  await writeFile(`${assetDir}/${name}.svg`, svg);
  await sharp(Buffer.from(svg)).resize({ width: 1200 }).png().toFile(`${assetDir}/${name}.png`);
}
