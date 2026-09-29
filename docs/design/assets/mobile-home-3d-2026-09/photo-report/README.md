# 写真日報・駐車後メーターの確認

2026/09/23。画面は架空データ。nativeはiOS26のSimulator/Expo Go。browserは隔離Chrome。

- `native-report.png`: 実DailyReportForm。メーター手入力なし、画像の84件取り込み、入力欄56px以上。
- `native-parking.png`: 日報完了後の駐車記録。メーター→場所写真の2枚。位置不明・送信失敗でも写真を保持して再試行。
- `browser-parking-320.png`: 同じParkingPreviewをDOM表示、320pxで確認。

PC1280/768/390/320で横はみ出しなし。ブラウザ/Simulatorで開始写真、終了→日報→完了→駐車写真、反射警告/再撮影、日報・駐車の送信失敗/再送を操作した。日報画像/写真撮影/解析/測位/送信は架空。本番写真・LLM精度・実機のカメラ品質を検証した結果ではない。

実装と未接続範囲: [写真日報設計](../../../mobile-photo-report-2026-09.md)。
