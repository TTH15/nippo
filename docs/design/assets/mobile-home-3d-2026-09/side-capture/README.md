# 車両の側面を横向きで撮る（2026/09/23）

## 変更

- 通常アプリのCaptureFlowとExpo Go試作CapturePreviewで、共通SideCaptureOverlayを使用。左右だけ大きなスマホ回転図と「スマホを横向きに」を表示。横持ちになったら車両ガイドを広く取り、シャッター・フラッシュ・広角を横に置く。
- 画面全体のOS回転ロックを変えず、縦固定のカメラ上で操作面を±90度回転。ホームとタブは縦のまま。撮影済みの確認は撮影時の方向を維持。「撮り直す」は左、「この写真を使う」は右。
- センサーはexpo-sensors（Expo 57適合の57.0.3）。左右の撮影中・前景のみ100ms間隔で購読。250msの安定を確認し、縦へ戻ったらシャッターを閉じる。写真確認・他ステップ・取消・背景化で解除。
- センサー使用不可/イベントなしは、横持ちにして手動で進む入口を表示。通常カメラの既存点検スキップも維持。プレビューの回転ボタンはシミュレーター/ブラウザ向けの向き再現。
- iOS CameraViewは `responsiveOrientationWhenOrientationLocked` を車両点検で有効化。画面が縦固定でも端末向きに合わせた保存を行う。側面の撮影結果がwidth<=heightなら採用せず再撮影案内。APIの仕様は[Expo Camera](https://docs.expo.dev/versions/latest/sdk/camera/)、センサーは[Expo Accelerometer](https://docs.expo.dev/versions/latest/sdk/accelerometer/)。実装はインストール済みSwift/Kotlinの軸・向き処理も照合。

## 再利用元

`CaptureFlow.tsx`、`CapturePreview.tsx`、`VanGuideOutline.tsx`、`CaptureActions.tsx`。既存のユーザー提供SVG由来の側面PNGを維持。ブラウザのSideCaptureReviewは共通UIの配置を複製、手順は既存CaptureReview。

## 開く

`node scripts/serve-mobile-preview.mjs --port 3202` → `/preview/admin/mobile?screen=home-design&board=ribbon&state=side-photo&revision=landscape`。
このURLのみ前の架空手順を通過済みにして右側の案内を直接開く。通常の開始/終了フローも同じ実装。
ブラウザは「確認用：左へ回転／右へ回転」で端末を持ち替えた状態を再現。表示画像は縦のディスプレイ座標でキャプチャしているため、端末と同じように横にして見る。原本画像や生成AIは使用しない。

## 検証

- mobile型、既存Web preview型、36テスト成功。通常モードのiOS JS export成功（/tmp/hakotora-side-capture-ios）。配布/署名ビルドは未実行。
- ブラウザ1280/768/390/320pxで回転図、撮影前の制止、左右回転、横長の枠、撮り直し/採用の順序、縦へ戻す、後方/メーターで通常配置へ戻る、取消、動き軽減。JSエラー/横はみ出しなし。
- Simulatorは前→右→後→左→メーターの流れ、回転ボタンで両向き、撮り直し、取消を確認。さらにSimulator内だけセンサー入力を差し替え、250ms安定・縦復帰・確認時の購読停止/撮り直し時の再開/取消停止を確認し、差し替えを復元。
- 実iPhoneでの向き判定・上下方向・実カメラの保存画像（EXIF/縦横/構図）、Android実機は未確認。Expo Goの撮影は引き続き架空。Codex内ブラウザの表示要求はqueuedで、実画面監査はローカルChrome。
- 新しいnative依存を追加したため、内部配布は新しいビルドが必要。runtimeVersionは既存のfingerprint方針。EAS/Apple/Google/DB/公開は変更なし。
