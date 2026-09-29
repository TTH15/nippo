# マイページと設定の統合（2026/09/24）

ユーザー指定: 右上の歯車とマイページを統合。プロフィールを一度に並べず、変更頻度の低い振込口座などは奥へ置く。

## 入口と階層

- 新ホームの歯車、マイページのヘッダー歯車を撤去。下部「マイページ」タブに入口を統一。
- マイページ: 名前/ドライバーコード付きプロフィールへのリンク、地図・振動、ログイン・電話番号、登録情報グループ内の振込口座。
- 最上位には住所・電話番号・口座番号・入力フォームを展開しない。振込口座だけは登録済み/未登録/確認中/取得失敗の状態を示す。未登録には初回支払前の登録案内を残す。
- プロフィールの先: 従来の登録情報の読み取り専用一覧。口座項目はここからも外し、口座画面に集約。
- 振込口座の先: 既存の銀行名/支店・番号・名義の編集と保存。取得失敗時は空フォームを出さず再読み込み。保存前に戻る際は破棄確認。数値の検証とAPI契約は従来のまま。
- ログイン・電話番号の先: SMS確認、かんたんログイン（パスキー）、ログアウト。認証要件や復旧経路は変更しない。
- 地図・振動の先: 既存の地図アプリ選択とスライド振動設定。プレビュー用の振動テストと状態変更もここに残す。本番統合時は開発用操作を除外する。

## 再利用と実装

- `src/components/MyPageMenu.tsx` の入口UIを `MeScreen` が使用。`MeScreen` はhome/profile/bank/securityの表示に分離し、保存・SMS・Passkeyの既存処理を使う。
- `AccountDetailScreen` はnative stackに登録し、ヘッダーの戻る操作と未保存の口座編集保護に `usePreventRemove` を使用。メニューが再フォーカスされたら登録状況を再取得。
- 通常 `apps/mobile/App.tsx` の従来のマイページも入口/詳細の階層へ変更。通常アプリには試作の地図・振動providerがないため、その設定リンクは新ホーム試作にのみ接続。設定の本番移植は引き続きM-D統合作業。
- ブラウザ `MyPageReview` は同じ `MeScreen` / `MyPageMenu` を使う。native stackの代わりにページ表示と戻るボタンを使用。未保存の戻る/タブ切替を確認する。`account-fixture.ts` と既存隔離servicesが架空データを提供し、口座の保存はメモリのみ。実認証/DB/SMS/本番口座へ接続しない。
- アプリ設定は既存の保存先を維持（ブラウザlocalStorage、Expo Go試作専用SecureStore）。口座の取得失敗を未登録と誤認しないよう、独立したloading/registered/missing/errorを導入。

## プレビューと検証

起動: `node scripts/serve-mobile-preview.mjs --port 3202`

URL: `http://127.0.0.1:3202/preview/admin/mobile?screen=home-design&board=ribbon&state=mypage&revision=account-hub`

Expo Go: `node scripts/start-mobile-ui.mjs` の新ホーム → マイページ。

- browser1280/768/390/320pxで入口/折り返し/歯車撤去/個人詳細の非展開を監査。プロフィール・設定・口座編集/未保存での戻り中止/保存/再表示・ログイン・未登録/取得失敗/再読込を操作し、JS例外なし。
- Simulatorで4画面へのnative stack遷移/戻る、口座の架空保存、地図/振動設定への移動を確認。JS例外・LogBoxなし。
- mobile型検査、通常iOS bundle export成功。APIやDBの変更/公開なし。実iPhoneでの表示、実口座更新、SMS送信、ネイティブPasskey動作の再検証は今回未実施。
- アプリ内ブラウザopenはqueuedで操作を取得できないため、同URLをローカルChromeで検証。監査画像は `assets/mobile-home-3d-2026-09/account-hub/`。native画像に重なる青い歯車は今回のMyPageMenu/Homeに含まれるUIではない。

今回の階層は初案。今後通知・表示などのアプリ設定が増えた時点で、利用頻度を見ながら項目を再整理する。未保存保護の対象は今回分離した振込口座編集。電話番号の確認手順の検証や認証仕様を混ぜて変更しない。
