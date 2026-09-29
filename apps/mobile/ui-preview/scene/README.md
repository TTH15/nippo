# 軽バン3Dの隔離試作

`npm run dev:ui -w @repo/mobile` で既存の純正タブ試作へ表示する。通常App/本番APIには接続しない。`NativeHomePreview.tsx` の仮画像を `VehicleScene` に置換し、稼働前は車が静止、稼働/移動シートでは車体が小さく弾み、車輪と景色が動く。休みには車を表示しない。

## 構成と素材

- `create-scene.ts`: Three.jsの共通シーン。nativeとブラウザが同じ車/背景/カメラを使う。背景は外部素材を使わず手続き的に生成。
- `VehicleScene.tsx`: Expo GLView、画面フォーカス/AppState/動き軽減、描画破棄、静止画切替。`sceneDiagnostics` は開発専用の診断値で、GPU時間ではない。
- `frame-loop.ts`: 動作時だけ最大30回/秒、稼働前/休みは1回、非表示時はRAFも停止。テストは120Hz・背景復帰・停止・重複ループを検証する。
- `assets/every-da17v.glb`: 既存Webモデルの別派生ファイル。8,719三角形を保ち、317meshを材質/車輪ごとの33meshに統合。448,940bytes。原本・Webの派生素材は変更しない。
- `assets/every-da17v.scene.json`: 同じ変換結果をThree ObjectLoader形式で格納。1,835,781bytes。ブラウザ向けGLBローダー/TextDecoder/画像ローダーをnativeへ持ち込まないPoC上の選択。本番採用前にバイナリ読込/起動時間を再評価する。
- 元の前方+XをY回転−90度で+Zへ正規化。四輪の中心と回転対象19部品/輪をmanifestに固定。wheelhouse、inner arch、mudflap等は車体側に残す。
- `assets/scenery-kit.glb`: 木2種・建物3種・雲3種・ベンチ・道路・歩道の計11点、129,172bytes。各点12〜336三角形。ノードを1点ずつ原点から取り出して配置するキットで、全体をそのまま表示すると重なる。
- `*-poster.png`: 同じモデル/カメラから出力したライト/ダークの静止画。AI生成画像ではない。nativeのダークUIはまだ実装せず、照明案/後続素材として保存。
- 前後プレートは `../vehicle.ts` の架空車両（京都 480 れ 12-34）を描画。対向車は56-78。車名・QR fixtureも同じ入力を参照する。ベースGLBの空白プレートは維持し、車体上へ文字面を追加。実車割当には未接続。

## 再生成

リポジトリのルートで実行する。

```sh
node scripts/prepare-mobile-scene.mjs
node scripts/prepare-mobile-plate-textures.mjs
node scripts/export-mobile-scenery.mjs
node scripts/serve-mobile-preview.mjs --port 3202
```

起動したプレビューの `http://127.0.0.1:3202/preview/admin/mobile?screen=home-design&board=scene` を開く。静止画の再生成は、別ターミナルで `node scripts/render-mobile-scene-posters.mjs`。Playwrightが通常のNode探索パスにない場合は `PLAYWRIGHT_MODULE` に既存インストール先を指定する。Chromeは `CHROME_PATH` で指定可能。出力ハッシュとカメラ/rendererの由来は各manifestに記録する。

## 互換性と制限

`expo-gl@57.0.2`、`three@0.180.0`、`@types/three@0.180.0` をmobileに固定。R3F/Router移行やroot React依存追加は行わない。Expo57のWebGL2がWebGL1クラスを継承する点とThree r180のinstanceof判定が衝突するため、実際のOpenGL ES3能力を確認したローカルProxyで橋渡しする。グローバル型やnode_modulesは変更しない。

依存へnative moduleを追加したため、後日の署名開発/配布ビルドは再生成が必要。既存バイナリへOTAだけでGL機能を追加できるとは扱わない。今回EAS/Apple/DB/本番/OTA公開は実施しない。

実車割当・GPS・実QR・業務保存・走行速度は接続しない。アニメーションは一定速度の演出。完全なダークUI、実機10分の発熱/メモリ/操作応答、Android/旧OS、読み上げの詳細監査は別工程。表示失敗で開始/終了ボタンを無効化しない。

## 2026/09/23 検証結果

- ユーザーのiPhone/Expo Goで「車と流れる景色が表示された」と確認済み。実機の10分連続計測や熱/電池は未測定。
- ブラウザで4状態、停止/再開、動き軽減、ダーク照明、故障再現→静止画→復旧、1280/390/320pxを操作確認。9,563三角形、46 draw calls、texture 0。外部通信/pageerror 0。
- iOS26シミュレーターではHomeの3D表示は確認できたが、native sheet内ではApple Software Rendererの描画結果が空白になる。呼出回数は出るためrenderer.infoだけで表示成功としない。MSAA 0/2/4、sheet遷移後の生成、単一context化、framebuffer再bind/flushでも解消せず、このrendererの稼働/移動だけ静止画へ自動退避。Macで動きを見る場合は同じシーンのブラウザ版を使う。実機へこの判定は適用しない。
- 退避前のSimulatorで3秒あたり81〜89回のrender呼出しを記録したが、sheetが空白だったため**表示FPSとして扱わない**。初回のrender呼出しは約4.16秒、再作成後も約0.9秒、ウォーム後は約1〜1.5ms。GPUフレーム時間ではない。実機の初回表示待ちを別途測定してから本番へ採用する。
- 非表示/背景化はGLView自体を外してGPU資源を解放。GLViewを所有する画面は同時に1つ。静止画は同じモデル/カメラから出力し、読込/表示失敗で業務操作を塞がない。Fast Refresh時はGPU資源を破棄して作り直す。
- unit 21件とmobile型検査成功。通常iOS JS exportの1406ソースにui-preview/Three/expo-glのJS混入なし。ただしnative依存としてexpo-glは追加されているため、将来の署名バイナリは再ビルドする。

### 道路の配置修正（2026/09/23）

中央線を道路の原点X=0へ揃え、幅6.2mを左右3.1mずつに分割。車は左車線中央X=1.55mへ移し、影・カメラも追従させた。車を画面中央に保ち、手前の背景には車体を隠さない余白を設ける。静止フォールバックも同じ配置で再生成済み。

### ミニチュア表現（2026/09/23）

`every-da17v-miniature-2`。ホームでは車種の形を保ちつつ、窓の `Glass` 材質だけを青灰色の不透明面に変更。内装を透過させず、灯火カバーの透過は維持する。これは共通シーンでの表示用変更で、元の車GLB/JSONの材質・形状は変更しない。

稼働/移動中は車体グループだけを1.5Hz、0〜3.6cmで上下させ、最大約0.34度のピッチ/0.23度のロールを加える。タイヤの中心と接地影は固定。稼働前/休みは静止、停止/動き軽減ではdelta=0の姿勢を保つ。背景は大きな窓・入口、段のある針葉樹と3房の広葉樹を頂点色で結合。現在10,997三角形/46 draw calls/texture 0。中央線と左車線の配置は維持。

背景GLBとライト/ダーク4枚の静止画を再生成。mobile・ブラウザSceneReviewの型検査、4状態/停止再開/動き軽減/照明/失敗復旧、1280/390/320pxのローカルChrome操作を確認。車輪中心固定とdelta=0時の姿勢保持も検証。アプリ内ブラウザは表示要求がqueuedとなり操作取得不可。今回の見た目と弾み方はiPhone未確認（先の実機確認は改修前）。本番公開なし。

### 対向車（2026/09/23）

`every-da17v-miniature-traffic-3`。既存の車を再利用し、内装/座席/灯火の透明カバーを省いて外装を1meshへ結合、青灰色に着色する。追加のモデルファイル/テクスチャなし。対向車は背景用のため車輪を個別回転させず、車体の弾みも省略する。接地影と合わせて追加2 draw calls（通過中18,536tri/48描画、通常10,997tri/46描画）。

稼働/移動のみ22秒ごとに最大1台。対向車線X=-1.55m、方向-Zで自車の前方+Zと逆向きに通過。自車を正面から映すカメラなので画面手前から奥へ抜ける。登場は画角外、退場は霧の奥。停止・動き軽減・非表示時の既存描画ループ制御に従い、復帰時に時刻を飛ばさない。稼働前/休みは対向車geometryを生成しない。

型検査2種、PC/スマホ幅、4状態・停止再開・動き軽減・失敗復旧を確認。60秒のシーン時刻進行で稼働/移動は各3台、静止2状態は0台、対向車線/向き/停止時の座標維持を確認。今回のiPhoneでの目視と性能計測は未実施。静止ポスター/背景キットは再生成後も同一ハッシュ、source manifestのみ更新。

### 稼働シート全体への表示と円周ゲージ（2026/09/23）

`every-da17v-immersive-4`。稼働/移動シートの背景を全面のGLViewへ拡張し、共通シーンに縦長用のカメラ構図を追加。水平の見える範囲を固定して車を大きく保ち、上寄りへ配置する。車両カード/終了ボタンは暗いグラデーション上に置く。小さい画面では操作部分をスクロールでき、背景は固定。通常ホームのカード構図は維持する。

`session-presentation.ts` のグラデーションをnative（RNのexperimental_backgroundImage）とブラウザで共用。nativeの実キャプチャでも表示を確認。GLの再生成キーに高さを含める。既知のSimulator software renderer退避と非表示時のGL破棄は継続する。`session-poster.png` は同じ縦長カメラの実描画（388×746、53,374bytes）、UIやグラデーションは焼き込まない。再生成スクリプトは従来4枚にこの1枚を追加する。

共有PunchButtonは円周ゲージに変更。800ms・12時から時計回り・線形充填、指を離すと150msで戻す。開始/終了の色は維持する。busy/blur/背景化/アンマウントで保留中の完了を無効化し、古い完了callbackが次の押下を確定させない。ReanimatedのReduceMotion.Neverで操作に必要な保持時間を確保（装飾的な3Dの動き軽減とは別）。長押し設定はhold-settings.tsに集約。ブラウザは同じ時間と操作を使うSVGゲージで再現する。

確認: mobile/ブラウザstrict型検査、既存21テスト、Simulatorで5タブ・短押し取消/長押し開始終了・開閉・移動/給油・ホーム復帰・休み、開始/終了のゲージ途中画像。ブラウザは1280/390/320px、短押し/長押し/途中充填、縮小/再展開、表示失敗時の終了操作、3D4状態/停止/動き軽減を確認。通常iOS JS exportも成功、1376 sourcemap sourcesにui-preview/Three/expo-glのJSなし、hold-settingsは含む。これは署名ビルドではない。

未確認: 今回のiPhone目視、全面GLViewによるGPU/発熱/電池、旧OS/Android、動的文字サイズ/横向きの詳細監査。Simulatorのシート背景は静止画であり、実機の動画描画性能の証拠ではない。全体レイアウトは開発用試作のみ、共通PunchButtonの見た目は既存呼び出しにも反映される。業務API/保存の変更と公開は行わない。

### ナンバープレート（2026/09/23）

`vehicle-plate.ts` は512×256のDataTextureを生成し前後で共用する。ブラウザ/native共通で、Canvasや画像ローダーへの実行時依存なし。前後それぞれ2三角形、1描画追加。自車・対向車で別の2枚を使い、シーン破棄時は重複なくdisposeする。前側は原本の左寄りのプレート位置、後側は中央へ合わせ、車体の上下動にも追従する。

字形は既存の `apps/web/public/number_plate/` のSVG。`scripts/prepare-mobile-plate-textures.mjs` がWebの既存 `plateModel.ts::renderPlateTexture` をそのまま呼ぶ。共通字形/レイアウト/配色の複製はしない。生成RGBAをランレングスで格納し、nativeのDataTextureへ復元する。品川/あの旧フォント代用を廃止し、SVGの揃った京都/れの架空fixtureへ統一。新しいfixtureを使う場合はテクスチャを再生成し、未生成の番号を他の番号へ黙って置換しない。

ブラウザの「後ろから見る」で前後を確認可能。PC/390/320px、ダーク、停止/再開/動き軽減、表示失敗→静止画→復旧、Simulatorのホーム表示を確認。実機iPhoneで今回の文字の見やすさ・負荷は未確認。過去節のtexture 0は追加前の計測。新しい静止画の入力ハッシュはposter-manifestへ記録。
