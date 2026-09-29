# 撮影・駐車の隔離試作確認（2026/09/23）

- capture-*.png / parking-photo.png: ローカルChrome/Playwright。NativeHomePreview/CapturePreview/ParkingPreviewを複製したSessionShellReview/CaptureReview/ParkingReviewを使用。1280/390/320px、実際の画面遷移を操作して撮影。
- native-capture-*.png: iPhone 17 Pro / iOS 26.0 Simulator / Expo Goのnative試作。Hermesでコンポーネントの操作ハンドラーを呼び出して遷移を確認し、simctlで画面取得。実機のタッチ/カメラ検証とは区別する。
- 全て架空データ。QR認証・カメラ・アップロード・GPS・OS通知・地図保存は実行しない。青い歯車はExpo Goのオーバーレイ。
- 実機新フロー/背景検知/通知/通信断からアプリ再起動を挟む復旧は未検証。アプリ内ブラウザのopen要求はqueuedのため、操作証跡はChromeのもの。
