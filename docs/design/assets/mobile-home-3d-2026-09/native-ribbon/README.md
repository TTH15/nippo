# Expo Go向けリボンと撮影画面（2026/09/23）

iPhone 17 Pro / iOS26 Simulator / Expo Go57.0.9の実装キャプチャ。`NativeHomePreview.tsx`・`RibbonControl.tsx`・`CapturePreview.tsx`を使用。青い歯車はExpo Goの開発用オーバーレイ。

- home: 開始リボン。stretch: 途中まで伸ばした状態。qr: 自動進行前。camera: 復元した車両線画と円形シャッター。blur: 架空の品質警告。
- SimulatorでHermesのイベントコールバックから途中/縦移動/中断の取消、指を離した時の確定、全画面展開、取消後再試行、QR自動進行、4方向・メーター・送信・終了取消を確認。物理タッチの自動試験ではない。
- ユーザーが手元のiPhoneで「スライドで開始」の表示を確認。実機の触感・全撮影手順・VoiceOverは未確認。
- 写真・QR・品質判定・フラッシュ・広角・送信は架空。本番APIへ接続しない。実カメラの接続と検証は別工程。
- リボン素材は `apps/mobile/ui-preview/assets/ribbon-band.svg` の自作ベクターをSharpでPNG化したもの。生成AI画像ではない。
