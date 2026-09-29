# 割当車両・駐車場所の試作確認

2026/09/23。NativeHomePreviewのレイアウトを複製したSessionShellReviewをChrome/Playwrightで操作。1280/390/320px、ライト/ダーク、地図の架空目的地表示、位置未確定で地図ボタンなし、休みで車両/背景なし、稼働シートの背景維持を確認。ページエラー/外部リクエスト0。

native-*はExpo Go / iOS26 Simulatorの画面。Hermesから状態切替のハンドラーを呼び出して確認。青い歯車はExpo Goのオーバーレイ。実iPhoneの目視/外部Maps起動は未検証。写真・駐車地・日時・車両は架空、本番APIなし。
