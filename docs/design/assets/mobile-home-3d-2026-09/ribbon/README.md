# ガラスのリボンから撮影画面への展開

2026/09/23。生成案②をブラウザで操作可能にした。`?screen=home-design&board=ribbon`。

- SessionShellReviewの同じホーム/稼働シートにRibbonControlを配置。背景・車両・駐車カード・タブ・その後の業務フローを再利用。
- SVGの帯とガラス調の玉が指に追従。右端近くまで動かして離すと、操作したリボンの位置から画面全体へ500msで展開。動きの曲線/時間はWeb共通motion値から構成。これはCSS/SVGの試作でApple純正Liquid Glassの描画ではない。
- 読み取り部分を帯の高さに固定しない。既存CaptureReviewを全高レイアウトへ切替え、320px幅でもviewfinder高さ300px以上を確保。実カメラ/QR/送信は架空で、写真の送信後のみ稼働を変える。
- drag.pngは操作途中、expanding.pngは実際の展開アニメーションを途中で一時停止して取得。camera*.pngは展開後。その他はホームとダーク。
- Chrome/PlaywrightでPC/390/320px、開始/終了、途中取消/解放時遷移、撮影取消/フォーカス復帰、キーボード/ボタン代替、動き軽減、タッチ横ドラッグ/縦スクロール取消、blur/展開中Escape・初期化を確認。既存work/moveのQR→撮影→送信→駐車、失敗/再試行の回帰も成功。エラー/外部通信0。
- アプリ内ブラウザ表示要求はqueued。操作証跡はローカルChrome。iPhone Safari実タッチ/native移植/実カメラは未検証。通常App/Expo Goは従来の方式を保持。
