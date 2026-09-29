# 横並びホームと地図設定

2026/09/24。再利用元: NativeHomePreview / SessionShellReview / VehicleScene / VehicleIdentity / RibbonControl。新しい地図URL生成はsrc/maps.ts、公開施設のfixtureはparking-place.ts。

- ブラウザ1280/768/390/320px: 横並び/車体の収まり/はみ出し、設定保存、リンク切替、途中取消、キーボード撮影開始を確認。
- 外部リンクは新タブへのURL引渡しをinterceptして検証。外部地図内の表示・実ナビ完走は未検証。
- Simulator: ホーム/設定、3種類の振動API、地図選択、Linking失敗→エラー表示→再試行成功で消去。ランタイム例外・LogBoxなし。振動の体感は実iPhone確認待ち。
- アプリ内ブラウザのopen要求はqueuedのため、操作監査はローカルChromeで実施。
- 公開施設の地点を表示する以外は架空データ。本番の車両位置・保存処理とは未接続。ブラウザ/端末の設定は別保存。
