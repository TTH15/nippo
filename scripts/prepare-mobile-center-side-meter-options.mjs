// 中央速度・左燃料・右水温の描き込み比較。針と走行距離の数値は描かない。
import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';

const assetDir = 'apps/mobile/src/capture/assets';
const panel = '<path d="M26 254 V115 Q26 50 116 35 Q300 10 484 35 Q574 50 574 115 V254 Q574 309 519 309 H81 Q26 309 26 254 Z" stroke-opacity=".8" stroke-width="2.6"/>';
const speed = '<path d="M210 34 H390 Q403 36 409 65 L418 249 Q432 294 412 299 H188 Q168 294 182 249 L191 65 Q197 36 210 34 Z" stroke-opacity=".68" stroke-width="2.3"/>';
const side = '<path d="M62 260 V171 Q62 138 84 134 H147 Q168 135 171 160 L177 249 Q176 275 153 277 H84 Q62 276 62 260 Z M423 249 L429 160 Q432 135 453 134 H516 Q538 138 538 171 V260 Q538 276 516 277 H447 Q424 275 423 249 Z" stroke-opacity=".58" stroke-width="2"/>';
const odometer = '<rect x="246" y="252" width="108" height="27" rx="4" stroke-opacity=".68" stroke-width="2"/>';
const inner = '<path d="M214 51 H386 Q395 53 398 73 L406 235" stroke-opacity=".34" stroke-width="1.4"/><path d="M80 181 Q141 178 161 248 M439 248 Q459 178 520 181" stroke-opacity=".39" stroke-width="1.6"/>';
const text = '<g fill="white" stroke="none" fill-opacity=".6" font-family="Arial, sans-serif"><text x="300" y="147" text-anchor="middle" font-size="20">km/h</text><text x="84" y="166" text-anchor="middle" font-size="14">F</text><text x="159" y="267" text-anchor="middle" font-size="14">E</text><text x="516" y="166" text-anchor="middle" font-size="14">H</text><text x="441" y="267" text-anchor="middle" font-size="14">C</text><text x="231" y="272" text-anchor="end" font-size="11">ODO</text></g>';
const labels = [
  [225, 235, '0'], [218, 187, '20'], [238, 138, '40'], [267, 99, '60'],
  [307, 79, '80'], [348, 99, '100'], [380, 138, '120'], [389, 188, '140'],
].map(([x, y, value]) => `<text x="${x}" y="${y}" text-anchor="middle" font-size="17">${value}</text>`).join('');
const scale = `<g fill="white" stroke="none" fill-opacity=".59" font-family="Arial, sans-serif" font-weight="600">${labels}</g>`;
const majorTicks = '<path d="M211 222 L197 227 M205 176 L191 175 M218 127 L205 121 M250 84 L241 72 M305 65 L305 50 M357 84 L366 72 M391 127 L402 121 M397 176 L407 175" stroke-opacity=".61" stroke-width="2.8"/>';
const minorTicks = '<path d="M202 202 L193 204 M207 151 L198 147 M230 107 L220 98 M274 70 L269 58 M333 69 L338 57 M377 106 L387 97 M398 151 L407 147 M402 202 L410 204 M95 188 L95 178 M119 194 L124 184 M143 215 L153 208 M458 208 L448 215 M482 184 L477 194 M505 178 L505 188" stroke-opacity=".46" stroke-width="1.6"/>';
const detail = '<path d="M33 254 V115 Q33 57 118 42 Q300 18 482 42 Q567 57 567 115 V254" stroke-opacity=".28" stroke-width="1.4"/><path d="M85 189 Q140 186 154 247 M446 247 Q460 186 515 189" stroke-opacity=".3" stroke-width="1.2"/>';
const options = [
  panel + speed + side + odometer + inner,
  panel + speed + side + odometer + inner + text,
  panel + speed + side + odometer + inner + text + majorTicks + scale,
  panel + speed + side + odometer + inner + text + majorTicks + minorTicks + scale + detail,
];
for (const [index, content] of options.entries()) {
  const name = `meter-center-side-option-${index + 2}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="340" viewBox="0 0 600 340" fill="none" stroke="white" stroke-linecap="round" stroke-linejoin="round">${content}</svg>`;
  await writeFile(`${assetDir}/${name}.svg`, svg);
  await sharp(Buffer.from(svg)).resize({ width: 1200 }).png().toFile(`${assetDir}/${name}.png`);
}
