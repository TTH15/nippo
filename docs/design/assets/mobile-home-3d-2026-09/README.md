# ホーム3D・デザイン検討素材

2026/09/23。built-in `image_gen.imagegen` を使用。各 `.prompt.md` に実際のプロンプトを保存。CLI/APIフォールバックは使っていない。

| ファイル | 用途・参照 |
|---|---|
| `home-states-v1.png` | 初版3状態。ユーザー提供の `Anchor 2026-09-23 10.07.48.png` を参照 |
| `home-states-dark-v1.png` | 上記画像を元にしたダークの色/照明案 |
| `scenery-kit-v1.png` | 木・建物・雲・道路・ベンチの低ポリ制作参考 |
| `session-modal-v2.png` | 初版画像を元に、下部タブ・ミニバー・拡大モーダルへ構造を修正した最新案 |
| `model-inventory.json` | 既存Web GLB20仕様の静的計測。実機のGPU性能測定ではない |

画像はGLBや実装画面ではない。初版/ダーク画像のタブなし構造は採用せず、最新のモーダル案を優先する。車の正確な形は既存カタログ、ナンバーとアイコンはアプリの共通実装を正とする。素材画像中の標語は製品コピーに採用しない。

操作確認は `node scripts/serve-mobile-preview.mjs --port 3202` → `/preview/admin/mobile?screen=home-design`。画像切替と拡大表示に加え「タブとモーダルを試す」で操作の関係を確認する。実QR・GPS・通知・DBには接続しない。

`native/home.png`、`native/work-sheet.png`、`native/shift-mini.png` は画像生成ではなく、Expo GoのiOSシミュレーターで動く試作の実キャプチャ（2026/09/23）。`?screen=home-design&board=native` から参照できる。車の表示だけは生成済みの静止画を仮素材として使用。iPhoneでも純正タブ・シートの下スワイプ・ミニバーからの再展開をユーザーが確認済み。

`scene/` は実3Dモデルを載せた後の確認キャプチャ。`native-home.png` はシミュレーターのHome、`native-sheet-static.png` はsoftware renderer制限により静止画へ退避したsheet（動画/3D成功の証拠ではない）、`browser-working.png` は共通シーンのブラウザ描画。iPhoneはユーザーが車と流れる景色を確認済みだが、ここに実機スクリーンショットは含めていない。

実モデル・再生成手順・manifestは [mobileのsceneディレクトリ](../../../../apps/mobile/ui-preview/scene/README.md)。生成画像と実モデル/キャプチャを区別する。

`scene/road-centered.png` は中央線を道路中央へ揃え、車を左車線中央へ移した後のブラウザ確認画像。以前のキャプチャは変更前の記録として残す。

`scene/miniature.png` は窓の不透明化・背景の窓/樹形追加後の実3Dブラウザキャプチャ。車体の上下動は静止画では確認できないため、同じシーンの隔離プレビューで確認する。今回のiPhone目視は未確認。

`scene/oncoming.png` は既存軽バンを再利用した対向車が通過する実ブラウザ描画。元モデルの追加制作や画像生成は行っていない。

`scene/immersive-browser.png` はシート全体の実3D背景と操作UIを重ねたブラウザ版。`immersive-native.png` / `hold-ring-native.png` / `hold-start-native.png` はiOS Simulatorの実キャプチャ。Simulatorのシート背景は縦長ポスターへ退避している（実機動画ではない）。開始キャプチャはcaptionを円内へ移す直前の記録。生成画像は使っていない。
