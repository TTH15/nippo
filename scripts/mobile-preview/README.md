# ネイティブ画面の隔離プレビュー

QR読取テストは `http://127.0.0.1:3202/preview/admin/mobile?screen=qr-test`。Macではカメラを起動せず、iPhoneで読むための見本QRと成功/失敗アニメーションの再生ボタンを表示する。見本QRは架空の文字列で、車両照合・DB・APIに接続しない。

車体撮影テストは `http://127.0.0.1:3202/preview/admin/mobile?screen=vehicle-photo-test`。`node scripts/serve-mobile-preview.mjs --port 3202 --vehicle-photos <左側面> <背面> <右側面> <正面>` でユーザー提供の4画像をメモリに読み込み、127.0.0.1の隔離プレビューだけで大きく切り替え表示する。写真はリポジトリやブラウザのビルド成果物へコピーしない。ユーザー確認済みの右側面 `IMG_1678`、左側面 `IMG_1676` を撮影順の正面→右→背面→左で表示する。

iPhoneのExpo GoプレビューではQRと車体4方向に実カメラを接続している。Macのブラウザで見本QRと車体写真を表示してiPhoneを向ける。QRの角座標が届けば3つの角印と4辺をその位置へ動かし、位置情報が空なら中央の演出へ退避する。車両の照合・写真の画質判定・次工程の保存は架空。撮影画像は端末の一時ファイルとしてプレビュー内の確認だけに使い、送信しない。

2026/09/23追記: iOS実装はApple標準のNative Bottom Tabs・accessory・native sheetを優先する方針。以下のブラウザモックは構造と操作の確認用で、Liquid Glassの実描画・ネイティブ遷移は再現/検証していない。詳細は `docs/design/mobile-home-3d-2026-09.md` のiOS標準UI節。

```sh
node scripts/serve-mobile-preview.mjs --port 3202
```

`http://127.0.0.1:3202/preview/admin/mobile?screen=home-design` を開く。ライト/ダーク/素材の画像と、全体/稼働前/稼働中/休みを切り替えられる。画像追加やコード変更後はこのサーバーを再起動する。

ホームは画像によるデザインレビューで、ネイティブ画面や3Dの実行ではない。`WorkScreen.tsx`、`HeroVan.tsx`、`PunchButton.tsx` の既存コードと、ユーザー添付の稼働中画面を参照して作成した。生成画像の文字/車種の細部は実装の正本にしない。

ログイン・設定・退勤時の駐車は従来どおりmobileの実コンポーネントを再利用。API/認証は架空のサービスへ置換し、CSPで外部通信を拒否する。実機の現行ホームとFast Refreshは `docs/development/mobile-fast-refresh.md` の `dev:ui` を使用する。

「タブとモーダルを試す」は `BottomTabBar` / `WorkingMiniBar` の配置・状態、`PunchButton` の800ms長押しを土台にした新構造の操作モック。長押し→QR/撮影/送信→稼働、移動→QR/撮影/送信→移動中、下向きボタン/ハンドルからの縮小、ミニバーから再展開、タブ切替、テーマ切替、給油指定あり/なしと終了を試せる。各タブは架空の短いサマリーで、現行の実画面全体は未移植。開始/終了の撮影手順は下記の架空フローへ更新済み。実QR認可・実カメラ・日報保存・実位置追跡・実給油記録は動かさない。

「iOSの試作」には、実装後のiOSシミュレーターキャプチャを追加。ユーザーのiPhoneでも純正タブ表示・下スワイプで縮小・ミニバーから再展開を確認済み。ブラウザ自体がLiquid Glassを描画しているわけではない。

## 3Dの軽バンと背景

`?screen=home-design&board=scene` の「3Dを試す」は、mobileの `ui-preview/scene/create-scene.ts` をそのまま使用する。車1台と木/建物/雲/道路の描画、4状態、停止/再開、照明、故障→静止画→復旧を確認可能。既存のブラウザ隔離を維持し外部通信なし。iPhoneでは3D動作確認済み、Mac Simulatorのnative sheetはsoftware renderer不具合のため静止表示に退避。詳細はmobile側のscene/README.md。ブラウザ側の変更時は3202のプレビューサーバーを再起動する。

### 全面3Dの稼働中シートと長押しゲージ（2026/09/23）

`http://127.0.0.1:3202/preview/admin/mobile?screen=home-design&board=shell&state=working`。
`SessionShellReview` は `NativeHomePreview` の今回のレイアウトを複製、`SceneSurface` はnativeと同じ `create-scene.ts`、グラデーションは `session-presentation.ts` を再利用する。開始/終了ゲージはnativeのPunchButtonをDOM/SVGで再現し、800msの値は `hold-settings.ts` を共有する。`state=working` を外すとホームから開始できる。表示失敗/復旧も試せる。

PC/390/320px、開始/終了の短押し取消・長押し・途中充填、閉じる/再展開、3D失敗中の終了操作をChrome/Playwrightで確認。アプリ内ブラウザは表示要求がqueued、操作結果は取得不可。純正タブ/スワイプ/GPUの実機動作はDOMでは検証しない。通常App/実QR/位置/保存は未接続。

### 開始・終了の撮影と駐車写真（2026/09/23）

`?screen=home-design&board=shell&revision=capture-parking` をホームから開く。CaptureReview/ParkingReviewはnativeのCapturePreview/ParkingPreviewをDOMへ複製し、順序と確定条件は同じcapture-model/本体capture/stepsを共有する。既存CaptureFlowの撮影ガイド・確認操作を土台にした架空カメラ。

2026/09/26: `?screen=home-design&board=shell&state=working&revision=report-first` で稼働中シートの「日報を書く・修正する」→日報を先に開ける。終了後は点検撮影を経て駐車記録へ進む。ブラウザの写真・送信・位置は架空。本番WorkScreenは稼働中から実日報フォームを開き、独立駐車APIは点検4方向の保存を確認する。

2026/09/26: 会社別の追加撮影項目は `?screen=home-design&board=ribbon&state=closeout` の駐車記録で確認。メーター撮影後に必須のオイル交換シールと任意の鍵の位置・給油口・駐車場所が並び、必須写真がなければ送信できない。写真は架空。本番は会社設定APIから開始／終了／駐車の各時点の項目を取得し、実カメラと保存APIを使う。

長押し→QR→免許携帯確認（開始）→対象者のみ前/右/後/左→最後にメーター→送信。対象者と送信エラーを切り替えられる。終了後に画面内の「駐車を完了しましたか？」を開き、まだ/写真/送信失敗/再送/位置なしを試せる。通知は終了前候補の模擬表示であり、OSの検知・通知は発生しない。

Chrome/Playwrightで1280/390/320pxの稼働/移動開始終了・必須写真・送信失敗/取消・駐車写真/GPSなしを検証。iOS Simulatorでも同じ遷移を確認。新フローのiPhoneカメラ、実送信、自動検知、Web/Base地図反映、再起動をまたぐドラフト保持は未検証/未実装。通常アプリと試作の違いは `docs/design/mobile-capture-parking-lifecycle-2026-09.md` を参照。

### 稼働前の割当車両と地図導線（2026/09/23）

`?screen=home-design&board=shell&revision=assignment`。稼働前は背景なしの割当車両と駐車カードを表示。「地図で開く」は外部通信のない目的地確認へ進む。確認用スイッチで位置未確定/休みを試せる。iOSの本物の地図起動や実割当・位置APIは未接続。稼働中の走行背景は維持。

### 開始・終了の操作比較（2026/09/23）

`?screen=home-design&board=gestures`。円形長押し/横長長押し/右へスライド/タップ確認/タップで撮影の5案を同じ車両・駐車表示で比較。稼働前/稼働中を切替、すべて戻すで初期化。長押しは800ms、スライドはつまみを右端へ動かして離す。「ボタンで進む」でドラッグなしの確認へ。どの案も既存の架空CaptureReviewへ進み、撮影後の送信で確定。後続の「やめる」で同じ案に戻る。

素材・画面はSessionShellReview/既存ポスターを使用。新規GestureReviewはブラウザ専用で、nativeの採用方式は変更しない。PC/スマホ幅・マウス/キーボード/タッチエミュレーションを検証。実iPhoneタッチ/VoiceOverは未検証。

### 操作の遊び心を画像で比較（2026/09/23）

`?screen=home-design&board=gesture-concepts`。「楽しくなる操作の6案」から生成した6枚を切替。GestureConceptsは画像レビュー専用。動きは未実装で、画像中のタブ/コピー/車種細部は採用仕様ではない。生成プロンプトと意図は `docs/design/assets/mobile-home-3d-2026-09/gesture-concepts/` に保存。

### ガラスのリボンを試す（2026/09/23）

`?screen=home-design&board=ribbon`。ホームの黄色いつまみを右端へ動かして離すと、その枠から撮影画面全体へ広がる。途中で離すと取消。つまみのキーボード操作でも撮影へ進む（別の「ボタンで開く」は撤去）。QR/写真は架空。送信後の稼働シートでは終了にも同じリボンを使用する。既存SessionShellReviewとCaptureReviewを再利用し、比較用の長押し版はboard=shellに残す。

PC/390/320px・タッチ/キーボード・取消/動き軽減・撮影/送信の回帰を検証。実カメラ/nativeは未接続。生成画像との比較はboard=gesture-concepts。

3Dの前後プレートはネイティブ試作と同じ架空車両データから描画する。`?screen=home-design&board=scene&revision=plates` の「後ろから見る」で後面を確認可能。リボン/通常シェルにも共通シーンと更新済み静止画が反映される。本番割当・実車ナンバーは未接続。

## 採用リボンと撮影確認（2026/09/23）

`?screen=home-design&board=ribbon&revision=camera-guides`。QRは架空の有効コードを読み取り、照合中と確認済みを経て進む。「プレビュー設定」でQRなし/無効/通信エラー、車体撮影の要否、ブレ/はみ出し、広角非対応、送信エラーを再現できる。無効・通信エラーは理由を表示して再読み取りできる。車両写真は前→右→後→左の順で、判定が「問題なし」の場合だけ撮影後に自動進行する。メーターも走行距離と燃料計を両方判定できた場合だけ自動進行する。判定できない写真は手動確認を残す。送信前の一覧から各方向・メーターだけ撮り直せる。線画は13409b3のユーザー提供SVG由来。シャッターは円形。ブラウザのカメラ・画質判定は架空で、実カメラへは接続しない。native本体のCaptureFlowは判定器の接続口を持つが、通常アプリでは未接続のため手動確認を行う。


### 横並びの車両・外部地図・振動（2026/09/24）

`?screen=home-design&board=ribbon&revision=maps-haptics`。車両とプレートを横並びにし、狭幅でも車体が切れない画角にする。設定のAppleマップ/Googleマップを保存し、ホームの駐車場所から実際の外部URLを開く。見本は岡崎公園駐車場の公開地点で、実車の位置ではない。施設への地図リンクだけを外部通信の対象とし、写真/勤怠のfixtureは隔離を維持する。地図の移動手段・ナビ開始は地図アプリ側。ブラウザの選択はlocalStorage、Expo Goは専用SecureStoreキーで各端末内に保存し、相互同期しない。

振動は開始Medium/途中selection/端Heavy/完了notification Success。設定のOFFを維持し、API成功を実振動と見なさない。ネイティブ設定の3テスト（クリック/完了/通常振動）で切り分ける。通常振動は明示的なテストのみで、スライド中に自動フォールバックしない。実機での体感は未確認。


### メーターパネル全体（2026/09/24）

`?screen=home-design&board=ribbon&state=meter-photo&revision=full-meter` で撮影段階を直接表示。通常CaptureFlowと共通の計器盤外周ガイドを使い、速度計・燃料計・ODOを写す。見本はSVGで作った架空計器盤。撮影後はガイドを消し、撮り直すと戻る。`state=closeout` の駐車の記録でも同じ部品を使用する。実カメラ/送信は未接続。


### シフト確認（2026/09/24）

`?screen=home-design&board=ribbon&state=shifts&revision=shift-details`。実ShiftsScreenから共通化したShiftMonthContent/ShiftDayDetailを再利用。月カレンダー・正式コース名の日別一覧・日付詳細・共通プレート。希望休と、希望休/割当のない日を指定休として表示する。画面下で空/長い名称/読込中/取得失敗/休み取得失敗を切替可能。月送りのwrapperはブラウザ向け、実機は既存MonthPager/BottomSheet。詳細はdocs/design/mobile-shifts-2026-09.md。

### メーター形状・品質確認（2026/09/24）

`?screen=home-design&board=ribbon&state=meter-photo&revision=meter-quality`。「ガイド」の変更で10形状を切替。初期表示の「中央1眼・右燃料」はエブリイの参考写真に合わせた配置例で、アクティ参考の「左右2眼・中央燃料」、ミニキャブ参考の「中央速度・左右小計器」、ハイゼット参考の「丸型・燃料表示一体」、アトレー参考の「3連丸型・中央速度」も選べる。前五者は比較案4の固定数字・目盛り入りガイド。型式による自動判定ではない。プレビュー設定の写真判定から反射/ブレ/欠け/暗さ/TRIP/利用不可を選び、撮影→確認中→警告→撮り直しを試せる。MeterGuidePicker/Outline/QualityFeedbackは通常CaptureFlowと共通。800ms後の判定はfixtureであり画像解析ではない。数値読取・運営承認は未接続。起動: `node scripts/serve-mobile-preview.mjs --port 3202`。

駐車後の広い撮影UIは `?screen=home-design&board=ribbon&state=parking-place&revision=wide-place-camera` で直接表示。通常の「終了の手続き」から入る `ParkingPreview` と同じ画面を使い、縦に広いファインダー、四隅の構図ガイド、下部のシャッター、撮影後の撮り直し/採用を確認できる。Luup参考画像は画面内に複製せず、写真・送信は架空のまま。実カメラへの接続と実車での構図確認は後続。

`?screen=meter-guides` でエブリイ参考の中央1眼・右燃料、`?screen=meter-guides&layout=acty` でアクティ参考の左右2眼・中央燃料、`?screen=meter-guides&layout=minicab` でミニキャブ参考の中央速度・左右小計器、`?screen=meter-guides&layout=hijet` でハイゼット参考の丸型・燃料表示一体、`?screen=meter-guides&layout=atrai` でアトレー参考の3連丸型・中央速度を切り替え、それぞれ5段階で並べて比較。1は輪郭の基本案、2は二重輪郭、3は固定表記、4は数字と目盛り、5は細部まで。撮影画面にはユーザーが選んだ4を5形状とも反映。比較画面も4を初期選択し、クリックすると各案を拡大できる。色、針、実走行距離の数値は描かない。車両の型式による自動適用はしない。

シフトの最新表示は `?screen=home-design&board=ribbon&state=shifts&revision=rest-colors`。休みの背景色・4タブを確認できる。日報はタブを撤去し、`state=closeout` の終了の手続きから開く。

休みの日の最新ホームは `?screen=home-design&board=ribbon&state=off&revision=rest-touch`。ベンチの3Dを横ドラッグで少し見回し、ベンチや木をタップすると短く反応する。次の稼働日・コース・集合時刻、報酬と臨時稼働の入口も確認できる。「確認用：次の稼働予定あり」で予定なしを試せる。休日判定と次の稼働日は架空データ。iPhoneではホームの確認用設定から「今日は休み」を選ぶ。稼働前の挨拶と「本日の担当」は `?screen=home-design&board=ribbon&revision=greeting-course`。

休みの日の遊び構想は独立ページ `http://127.0.0.1:3202/preview/admin/mobile?screen=rest-playground`。上部で現在の `SceneSurface mode="off"` をそのまま触れ、三つのゲーム案を切り替えて体験と実装を比較する。下部にアプリへ入れる順番と Three.js + Expo GL / Unity / Godot の選択をまとめた。3Dシーンとロゴを既存ホームプレビューから再利用し、ゲーム画面・ダブルタップ入口は未実装。ブラウザ内の架空の設計資料で、本番API・DB・位置情報には接続しない。起動は上記と同じ `node scripts/serve-mobile-preview.mjs --port 3202`。

### マイページに設定を統合（2026/09/24）

`?screen=home-design&board=ribbon&state=mypage&revision=account-hub`。歯車入口を撤去し、プロフィール/地図・振動/ログイン・電話番号/振込口座への入口を置く。実MeScreen/MyPageMenuを再利用。口座フォームは1段奥で、保存は架空データのメモリのみ。「画面確認」で未登録/取得失敗/読込中を切替。口座の未保存で戻る/タブ移動、保存後の再表示も確認できる。詳細はdocs/design/mobile-my-page-2026-09.md。

### シフトの区切り・希望休提出（2026/09/24）

`?screen=home-design&board=ribbon&state=shifts&revision=request-submit`。薄いグレーの列境界、便数の点、大きい年月表示。「希望休提出」は実ShiftRequestViewを再利用し、全休/便ごとの希望休を選んで提出できる。保存は架空fixtureのメモリのみで、確認カレンダー/日付詳細にも反映する。画面確認から提出失敗/締切取得失敗/受付終了を選べる。月移動はブラウザ向けwrapper、nativeは既存MonthPager。起動は `node scripts/serve-mobile-preview.mjs --port 3202`。
