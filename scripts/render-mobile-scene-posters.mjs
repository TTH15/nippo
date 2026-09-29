// 起動中の隔離プレビューから、同じ3Dモデル/カメラの静止フォールバックを生成。
// PLAYWRIGHT_MODULEで既存のPlaywrightインストールを指定できる。外部サイトは開かない。
import { createRequire } from 'node:module';
import { writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 1050 }, reducedMotion: 'reduce' });
  await page.goto('http://127.0.0.1:3202/preview/admin/mobile?screen=home-design&board=scene');
  const out = 'apps/mobile/ui-preview/scene/assets'; const files = [];
  for (const dark of [false, true]) {
    if (dark) await page.getByRole('button', { name: 'ダーク照明へ', exact: true }).click();
    for (const [label, base] of [['稼働前', 'van'], ['休み', 'off']]) {
      await page.getByRole('button', { name: label, exact: true }).click();
      await page.waitForFunction(() => Number(document.querySelector('canvas')?.dataset.frames) > 0);
      const data = await page.locator('canvas').evaluate(canvas => ({ data: canvas.toDataURL('image/png').split(',')[1], width: canvas.width, height: canvas.height }));
      const filename = `${base}${dark ? '-dark' : ''}-poster.png`, bytes = Buffer.from(data.data, 'base64');
      await writeFile(`${out}/${filename}`, bytes); files.push({ filename, width: data.width, height: data.height, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    }
  }
  // 縦長シートも同じ共通シーンから出力。操作UI/グラデーションは画像へ焼き込まない。
  await page.goto('http://127.0.0.1:3202/preview/admin/mobile?screen=home-design&board=ribbon&state=working');
  const sheet = page.getByRole('dialog', { name: '稼働中モーダル', exact: true });
  await page.waitForFunction(() => Number(document.querySelector('[aria-label="稼働中モーダル"] canvas')?.dataset.frames) > 0);
  const data = await sheet.locator('canvas').evaluate(canvas => ({ data: canvas.toDataURL('image/png').split(',')[1], width: canvas.width, height: canvas.height }));
  const filename = 'session-poster.png', bytes = Buffer.from(data.data, 'base64');
  await writeFile(`${out}/${filename}`, bytes); files.push({ filename, width: data.width, height: data.height, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  await writeFile(`${out}/poster-manifest.json`, JSON.stringify({ source: 'create-scene.ts', sourceSha256: createHash('sha256').update(await readFile('apps/mobile/ui-preview/scene/create-scene.ts')).digest('hex'), plateInputs: Object.fromEntries(await Promise.all(['apps/mobile/ui-preview/vehicle.ts', 'apps/mobile/ui-preview/scene/vehicle-plate.ts', 'apps/mobile/ui-preview/scene/assets/plate-textures.json'].map(async path => [path, createHash('sha256').update(await readFile(path)).digest('hex')]))), vehicleSha256: JSON.parse(await readFile(`${out}/manifest.json`, 'utf8')).glbSha256, renderer: 'Three 0.180.0 / Chrome SwiftShader / ACES exposure 1.05', generatedImages: false, files }, null, 2) + '\n');
  console.log(files);
} finally { await browser.close(); }
