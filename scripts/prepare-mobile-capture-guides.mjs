// 原本: 13409b3 の VanGuideOutline.tsx（2026/08/04 ユーザー提供Illustrator線画）。
// Expo Goへ依存を追加せず同じSVGをPNG化して重ねる。
import sharp from 'sharp';
for (const side of ['front', 'rear', 'side']) await sharp(`apps/mobile/src/capture/assets/van-${side}.svg`).resize({width:1024}).png().toFile(`apps/mobile/src/capture/assets/van-${side}.png`);

// 計器盤の全体ガイドと、隔離プレビュー用の架空計器盤。
await sharp('apps/mobile/src/capture/assets/meter-panel-guide.svg').resize({ width: 1200 }).png().toFile('apps/mobile/src/capture/assets/meter-panel-guide.png');
await sharp('apps/mobile/ui-preview/assets/meter-panel-sample.svg').resize({ width: 1200 }).png().toFile('apps/mobile/ui-preview/assets/meter-panel-sample.png');

for (const layout of ['center-right', 'dual-center-fuel', 'center-side', 'single-digital', 'triple-center', 'round', 'right', 'left', 'wide', 'generic']) {
  for (const [dir, suffix] of [['apps/mobile/src/capture/assets', 'guide'], ['apps/mobile/ui-preview/assets', 'sample']]) {
    await sharp(`${dir}/meter-${layout}-${suffix}.svg`).resize({ width: 1200 }).png().toFile(`${dir}/meter-${layout}-${suffix}.png`);
  }
}
await import('./prepare-mobile-meter-options.mjs');
await import('./prepare-mobile-dual-meter-options.mjs');
await import('./prepare-mobile-center-side-meter-options.mjs');
await import('./prepare-mobile-single-digital-meter-options.mjs');
await import('./prepare-mobile-triple-meter-options.mjs');
