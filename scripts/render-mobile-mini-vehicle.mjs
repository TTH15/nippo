// 既存の車両・ナンバーを透明背景で静止描画。ミニバーではGLを動かさない。
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { outputFiles } = await require('esbuild').build({
  stdin: { contents: `
    import * as T from 'three';
    import { createDrivingScene } from './apps/mobile/ui-preview/scene/create-scene';
    const world = createDrivingScene('idle');
    world.scene.background = null;
    const renderer = new T.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(288, 192);
    renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    world.resize(288, 192); world.camera.fov = 22; world.camera.updateProjectionMatrix();
    renderer.render(world.scene, world.camera);
    globalThis.vehiclePng = renderer.domElement.toDataURL('image/png');
    world.dispose(); renderer.dispose();
  `, resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', platform: 'browser',
});
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage();
  await page.setContent('<!doctype html><html></html>');
  await page.addScriptTag({ content: outputFiles[0].text });
  const data = await page.evaluate(() => globalThis.vehiclePng);
  const path = 'apps/mobile/ui-preview/scene/assets/mini-vehicle.png';
  const bytes = Buffer.from(data.split(',')[1], 'base64');
  await writeFile(path, bytes);
  console.log({ path, width: 288, height: 192, bytes: bytes.length });
} finally { await browser.close(); }
