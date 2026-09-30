# ハコ虎のネイティブ画面を保存直後に確認する

2026/09/23。Apple組織登録待ちでも画面を調整するための、ローカル開発専用モード。

## 起動

リポジトリルートで実行する。

```sh
npm run dev:ui -w @repo/mobile
```

Macのサーバーを動かしたまま、iPhoneを同じLANへ接続する。iPhone標準カメラでターミナルのQRを読み取り、Expo Goで開く。iPhoneのExpo GoとCLIは同じExpoアカウントでサインインする。CLIは `npx expo whoami`、Expo Goは右上のアカウントアイコンで確認する。パスワードをリポジトリやチャットへ保存しない。

Expo Goのローカルネットワーク許可を有効にする。端末への直接起動コマンドの成功は、アプリ画面が表示された証拠にはしない。

Macだけで確認する場合はターミナルで `i` を押してiOSシミュレーターを開く。この操作は手元のiPhoneを開く操作ではない。`r` で再読み込み、Ctrl+Cで停止。接続用IPはネットワークが変わると変わるため、その都度QRを使う。

`apps/mobile/App.tsx` と `src/` の画面を編集して保存すると、通常はFast Refreshですぐ反映される。アプリ再インストール・EASビルド・OTA公開は不要。状態を維持できない変更では再読み込みになる。ネイティブ依存・署名・権限を変更した場合は開発ビルドの作り直しが必要。

## 画面とデータ

- 初期表示は新ホームのnative試作。ホーム右上のメニューからシフト・報酬・マイページを開ける。本番の `App.tsx` と認証・業務APIはこの画面確認モードでは起動しない。
- ホーム右上のメニューに「ログイン確認」がある。実際の `LoginScreen` を開き、上部の「次の端末保存を失敗させる」でPasskey/SMSログイン後の保存エラーと再試行を試せる。認証結果は架空で、認証情報の保存はメモリfixtureへ差し替える。地図・振動設定の端末保存とは分離する。SMSの確認コードは `123456`。
- 架空ユーザーで開始する。ログアウト後のSMS確認コードは `123456`。出退勤・日報・設定操作はメモリ内だけで処理する。
- MetroだけでAPI/認証/bootstrapをfixtureへ差し替える。本番SecureStoreを読まず、本番APIへ送信しない。未対応APIはエラーにし、本番へのフォールバックを行わない。
- 起動スクリプトは `.env` を読み込まず、API URLを `https://preview.invalid` へ固定する。GPS、Passkey、端末ロック、OCRはスタブ。写真アップロードは拒否する。カメラ等のOS許可画面が出る機能はある。
- PasskeyのOS認証、実SMS、実GPS、OCR精度、実際の日報保存、OTAはこのモードの検証対象外。正式な開発ビルド・内部配布で確認する。
- preview用resolverは環境変数 `HAKOTORA_UI_PREVIEW=1` のときだけ有効。fixture解決はdev bundleのみ許可し、export/productionでは停止する。通常のexportにはfixtureが含まれないことをsourcemapで確認する。
- 隔離モードの `ui-preview/App.tsx` も `global.css` を読み込む。本番 `App.tsx` だけに置くと、再利用したシフト・報酬などのNativeWind画面で色・余白・配置が消える。

## クラッシュを直した経緯と依存関係

Expo Go 57.0.9 + Worklets 0.10.0ではJS初期化時に `EXC_BAD_ACCESS` が発生した。SDK57の指定に合わせてReact Nativeを0.86.3、Reanimatedを4.5.1、Workletsを0.10.1へ更新した。mobileとBaseのReact Nativeを揃え、rootのoverridesでnative/Babelの重複解決を防ぐ。rootへの直接依存追加は行わない。

旧Workletsがrootに残ると、Babel plugin 0.10.0 / JavaScript 0.10.1の不一致が出る。`npm ci` でlockfileどおりにインストールし、依存更新後の初回は開発サーバーをキャッシュクリア付きで起動する。

```sh
npm ls react-native react-native-reanimated react-native-worklets
# 必要時のみ。既存のサーバーを止めて実行する
npm run dev:ui -w @repo/mobile -- --clear
```

2026/09/23: MacのiPhone 17 Proシミュレーター（iOS26.0、Expo Go57.0.9）でホーム表示・Fast Refresh・稼働状態切替を確認。実機iPhone15もExpo Go57.0.9で、CLIと同じアカウントへのサインイン後、ユーザーがホーム表示を確認し、Metroでも実機接続を確認した。実機上の変更前後の表示比較は未完。mobile/Base型検査と18テスト成功。通常iOS JS exportのsourcemapにfixtureがないことを確認。残るExpo周辺パッケージの推奨patch差分は別途あり、全依存が推奨最新版という意味ではない。

旧署名なしRelease成果物は今回の依存更新前のもの。更新後のネイティブコンパイル・署名配布は別途再検証する。既存の `/tmp/hakotora-mobile-release-20260923` 候補を今回の修正版として使い回さない。

参考: [Expoの起動・端末接続手順](https://docs.expo.dev/get-started/start-developing/)、[関連するExpo Go/Worklets不一致の報告](https://github.com/expo/expo/issues/48390)。

## Native Tabsと稼働シートの試作（2026/09/23）

`apps/mobile/ui-preview/NativeHomePreview.tsx` を編集すると、上記の `dev:ui` でFast Refreshされる。追加パッケージなしで、既存の `@react-navigation/bottom-tabs/unstable`（lock上7.18.14）とnative-stackを使用。iOS26以降のミニバーは純正 `bottomAccessory`、拡大は当初nativeの `formSheet`。終了リボンとの競合報告後、`transparentModal` とリボンを優先する独自の下ドラッグへ変更した。

1. 「スライドで開始」を右端まで動かして離す→全画面QR→自動進行→安全確認→対象者の車両4方向→メーター→架空送信。実カメラやAPIは呼ばない。途中で離すと戻る。
2. シート左上の下向きボタン、またはハンドルを下へスワイプして閉じる。タブ上の稼働中バーから再展開できる。タブ切替ではセッションを終了しない。
3. 「車両の移動」も同じ開閉を使用。確認画面の「移動依頼：給油あり」をオンにした場合だけ給油依頼を表示。任意の給油記録は架空の確認ダイアログで処理する。
4. 日報・シフト・報酬・マイページは既存コンポーネントを架空APIで再利用。終了もリボンから撮影手順へ進む。本番の点検・日報連携を完了したものではない。
5. 2026/09/24、上部のベージュの確認用バーと「既存画面へ」の切替を撤去。新ホームを直接表示する。試作状態はメモリ内だけで、再読み込みで初期化される。架空APIへの隔離と配布用bundleへの混入防止は維持。

シミュレーターiPhone17Pro/iOS26.0/Expo Go57.0.9で5タブ、長押し取消/開始/終了、稼働と移動、給油指定、休み、終了後のホームを確認。Hermesのイベントコールバック実行とネイティブ画面キャプチャを使用し、実タッチの自動試験ではない。**手元のiPhoneではユーザーが新タブ表示、下スワイプで閉じる、ミニバーから再展開を確認済み**。

mobile型・既存18テストが成功。通常iOS JS exportのsource map（1406 sources）に `ui-preview` がなく、架空データ/生成ポスターのコードも含まれないことを確認した。署名ビルド/配布ではなくローカルのJS出力検証。

車は配置確認用の生成ポスターで、GLB/3Dアニメーションは未実装。実QR/点検・GPS追跡・給油保存・本番認可、Android、旧iOS、ダーク/透明度設定、VoiceOver、キーボード時の全画面監査は次段階。依存はlockfileの版で試しており、unstable APIの更新は自動採用せず検証する。

### 3Dの軽バンを確認する

2026/09/23、仮画像を実際の3Dモデルへ置換。稼働開始→架空QRの後はタイヤと景色が動き、「動きを止める」「静止画で表示」で比較できる。OSの動き軽減時は静止。画面を閉じる/背景化でGLViewを破棄し、戻ると再生成する。試作はFast Refreshで反映するが、GPUの状態はその際に作り直す。

iPhoneでは車と流れる景色を確認済み。MacのiOS26 Simulatorはsheet内のsoftware GLが空白になるため、稼働/移動は自動で静止表示。Macで動きを確認するには `http://127.0.0.1:3202/preview/admin/mobile?screen=home-design&board=scene` を使用する。新しいネイティブ依存があるため、Expo Go以外の既存開発バイナリは次回再ビルドが必要。署名や配布は行っていない。

制作・再生成・検証範囲: [3D試作README](../../apps/mobile/ui-preview/scene/README.md)。


### リボン・撮影画面の確認（2026/09/23）

ユーザーがiPhoneで「スライドで開始」を確認済み。`RibbonControl.tsx` / `CapturePreview.tsx` の変更もFast Refreshで反映する。撮影画面下部の「プレビュー設定」でQR不在/不正、点検の有無、ぶれ/枠外、広角対応、送信失敗を切り替える。フラッシュと広角はこのモードでは表示のみで実機能は動かない。Simulatorの取消・再試行・全画面展開・撮影順と29テストを確認。実機の触覚・実撮影・VoiceOverは未検証。


### スライドの振動・スクロール競合（2026/09/23）

マイページの設定で「スライドの振動」を変更。試用ボタンは設定オン時のみ使用できる。端末に保存し、次の起動にも反映する。初期値はオン（読み込みが失敗した場合はオフ＋エラー）。設定画面の保存失敗時は直前の値に戻す。ブラウザの同名設定は別保存であり実機と同期しない。

稼働/移動モーダルはリボン以外の車・背景・ハンドルから下へドラッグできる。途中で離すと戻り、十分下げるとミニバーへ閉じる。内容が途中までスクロールされていれば内容を優先。UIKit sheet panの代わりにSessionSheetで競合を制御し、下向きボタンも残す。リボンはつまみのtouch開始から親スクロールを一時停止し、上下のずれを許容する。小画面/大文字時のスクロールを一律禁止しない。

`RibbonControl.tsx` はPanResponderの古いコールバックがFast Refreshで残らないよう `@refresh reset` を指定。変更反映中のスライドは初期状態へ戻る。Simulatorとブラウザの検証は成功し、追加修正後の終了操作もユーザー確認済み。触覚は設定オン・API42回受理でも振動なし。低電力オフ/アクセシビリティのバイブレーションオンは確認済み。

2026/09/24の実機再確認: iPhone 15 / iOS 26.6.1 / Expo Go 57.0.9で新ホームと稼働シートの下ドラッグ追従を確認。端末の通常振動とホーム画面の触覚は動作するが、Expo Go内の`expo-haptics`のselection/impact/notificationは実際の触覚が出ない。API成功は触覚発生の証拠にならない。通常振動は実機で動いたが長く、スライド途中の短い節目には使わない。スライドの通知を接触・12%移動・75%到達・スライド確定の4節目へ整理した。スライド確定は撮影入口のためsuccess触覚は使わない。実機で短い触覚を確認するには、署名済み開発ビルドで再検証する。
