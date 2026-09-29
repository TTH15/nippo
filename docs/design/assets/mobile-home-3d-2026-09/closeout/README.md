# プレートと終了手続き

2026/09/24。実DailyReportFormと、Expo Go/ブラウザ共通CloseoutSummaryを使用。全て架空データ。

- `pending.png`: 駐車記録と日報の必須2項目。両提出後のみ完了表示。
- `plate-report.png`: WebのSVG字形由来のプレート。確認済み車両1台のみ、車両選択ボタンなし。
- `native-report-first.png`: 日報を先に送っても駐車記録が残り、完了扱いにしない。

Chrome1280/768/390/320で両順序・失敗再送・保留・GPS欠測と写真受理・字形枠内配置を確認。Simulatorでも日報先行から写真送信完了まで操作。HMR中のNativeWind警告を確認したため、Expo Goをコールド起動して再検証しLogBox/例外とも空。実機iPhoneの今回の表示は未確認。アプリ内ブラウザopenはqueuedで、同URLを別のローカルChromeで検証。

起動: `node scripts/serve-mobile-preview.mjs --port 3202`、`/preview/admin/mobile?screen=home-design&board=ribbon&state=closeout&revision=closeout`。`state=end-report` は日報、`state=done` は両提出済み。

状態はメモリのみ。実業務の未完了管理・再起動復元はサーバー側の永続化が必要。公開・DB変更なし。
