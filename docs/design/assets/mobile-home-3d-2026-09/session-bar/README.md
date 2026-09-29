# 稼働中バー・撮影への切り替え（2026/09/23）

- 再利用元: `apps/mobile/ui-preview/NativeHomePreview.tsx` のMiniBar、`RibbonControl.tsx`のCaptureReveal。ブラウザは既存SessionShellReview / CaptureRevealを同じ配置・色・切替方式へ更新。
- ネイティブ: iOS 26純正タブのbottomAccessoryに濃紺のバー。緑の状態点・既存車両画像・状態・実経過時間・上矢印。高さはOSのアクセサリー領域に従う。ブラウザは72pxの配置モック。
- 画像: 同じThreeモデルと既存SVG由来の架空ナンバーから透明PNG（288×192、約21KB）を出力。バー内では静止画像を使いGLを追加しない。再生成は `PLAYWRIGHT_MODULE=<Playwrightの場所> node scripts/render-mobile-mini-vehicle.mjs`。
- 撮影: リボンからの領域拡大を、全画面同時の250msフェードに変更。ネイティブはnative driver、ブラウザは共通motion値。視差効果軽減時は即時表示。開始/終了、取消後の再操作を維持。
- 検証: ブラウザ1280/768/390/320px、バーから開閉、タブ切替、100ms時点の全領域フェード（clipなし）、取消/再開、動き軽減、consoleエラーなし。Simulatorは開始の撮影完了→閉じる→シフト→バーから再開→終了撮影→取消。開始遷移の録画もフレーム確認。
- 画像: native-shifts.png=Simulator、browser-320.png=320px幅内のプレビュー、browser-transition.png=フェード途中。
- 起動: `node scripts/serve-mobile-preview.mjs --port 3202` → `/preview/admin/mobile?screen=home-design&board=ribbon&state=working&collapsed=1&revision=session-bar`。
- 制限: 架空データ/撮影。実iPhoneでの今回のバー・遷移は未確認。Codex内ブラウザへ開く要求はqueuedのため、画面監査は別のローカルChromeで実施。iOS 26以外のOS表示は未検証。本番・外部サービスの変更なし。
