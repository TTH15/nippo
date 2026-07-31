# 作業ログ

Claude Code の Stop フック（`~/.claude/bin/worklog-check.sh`）により、ファイル変更を伴うターンの終了時にエントリを追記する。

## 2026-07-24 初期登録フロー web一本化＋PIN撤廃 第1段（前セッション、事後記録）

- ブランチ `feat/onboarding-web-flow` にコミット3本（未push・main未マージ）:
  - `bb941fb` web KYC画面 `/register`・招待リンク `?code=`+QR・電話OTP初回ログイン導線・`/me` 本登録CTA
  - `028911d` mobile 電話OTPログイン＋ローカル生体ロック、`RegisterScreen`/`KycWizard` 退役（**要ネイティブ再ビルド**）
  - `427c847` 承認時の初期PIN発行を停止（現行PINログイン経路は無傷）
- 検証: web tsc クリーン・テスト 411 passed、mobile tsc クリーン
- 残課題: ブランチの push/マージ判断 → 本人系ルート約33〜41本の own スコープ化（「認証を固める」本丸）。ネイティブPasskey は 8/8 登記待ち、PIN第2段は移行一巡後

## 2026-07-25 作業ログ自動化フックの導入

- グローバル Stop フック `~/.claude/bin/worklog-check.sh` を新設し `~/.claude/settings.json` に登録（全プロジェクト共通）
- 動作: リポジトリに `docs/worklog.md` より新しい変更（未コミット差分 or 直近コミット）があれば、ログ追記を促してから終了。調査のみのターンは `touch docs/worklog.md` で回避可
- 検証: ブロック/通過/ループガードの3ケースをパイプテストで確認、jq で設定スキーマ検証済み

## 2026-07-25 初期登録ウィザード一本化（ようこそ→…→申請完了）＋承認1回統合

- `/join` を一本ウィザードに全面改修: ようこそ(会社名確認)→氏名→生年月日→電話→SMS認証→Face ID(Passkey・任意スキップ)→免許証(正面+期限)→顔撮影→住所→口座→申請完了(アプリ導入案内)。中断再開対応（セッション残存 or 招待リンク再訪+同一電話OTPで未完ステップへジャンプ）
- `POST /api/join`: dob 受領（identities.dob）＋ SMS検証成功時に **pending のままセッション発行**（issueDriverSession 流用。alreadyApplied の pending/active も再発行=再開用。inactive は発行しない）
- 承認1回統合: pending 一覧に本登録提出バッジ（提出済み/入力中/未提出）、承認モーダルに免許/顔のKYCレビューを組込み（can_view_pii のみ）、承認で PUT(active+driver_code) → verify-kyc(approve) を連続実行。KYC未提出承認・既存移行は従来の「本人確認待ち」リストで後追い
- 共有部品化: `lib/components/KycPhotoBox.tsx`（PhotoBox/fileToJpegBase64/formatDateInput）を新設し `/register` と `/join` で共用（顔撮影は capture="user"）
- docs/platform-design.md §2-1a を更新（一本化フロー図・pending セッション・承認1回統合、§7 Phase 8 に注記）
- 検証: tsc クリーン / web テスト 411 passed。未コミット

## 2026-07-25 単回招待リンク＋口座のオンボーディング除外（モバイル移管）

- **単回招待リンク（主経路化）**: migration `114_invites.sql`（token unique・氏名プリフィル・7日期限・used/revoked 管理）。`/api/admin/invites` GET/POST・`[id]` DELETE(失効)、`/api/join/lookup?invite=`、`POST /api/join` の invite 受理（used_at IS NULL の条件付きUPDATEで1回消費・申請済み再開は非消費）。運営 pending ページに発行UI（氏名任意→リンクコピー・失効・状態表示）。共有 join_code は「予備」に降格して併存
- **口座をオンボーディングから除外**: `/join`・`/register` の口座ステップ削除、`/api/me/registration` の complete 条件から口座除外（POSTでの保存は継続）、admin kycComplete も同期。申請完了画面に「口座はアプリのマイページで」の案内を追記
- **mobile**: MeScreen に「振込口座」セクション新設（GET/POST /api/me/registration。未登録なら初回支払いまでの登録案内）
- docs/platform-design.md §2-1a 更新（単回招待・口座除外・Phase 9 前倒し注記）
- 検証: web/mobile tsc クリーン / web テスト 411 passed。**migration 114 は Supabase 未適用**・未コミット

## 2026-07-26 招待の氏名プリフィル廃止・住所案内・規約同意

- **氏名プリフィル廃止**: 招待の氏名欄は運営手入力の伝聞のため、本人入力に一本化。invites.name は「宛先メモ（管理用・本人に非表示）」に位置づけ変更（lookup が name を返さない・wizard プリフィル削除・admin UI ラベル変更）
- **住所ステップ**: /join・/register に「運転免許証の記載どおりに入力」の案内を追加。OCR は導入しない（web は新規外部依存になる・運営の承認時目視で担保）
- **規約同意**: `/terms`・`/privacy` 新設（ドラフト・法人登記後に要リーガルレビュー）。ようこそ画面に同意チェック必須、`POST /api/join` で termsAgreed 必須化、migration `115_identities_terms_agreed.sql` で identities.terms_agreed_at に同意日時を記録
- 将来メモ: 業務委託契約の電子契約ステップ（org 設定制・KYC後〜申請確定前・「要点」+PDF）を §2-1a に記載
- 検証: web tsc クリーン / テスト 411 passed。migration 114・115 は Supabase 未適用・未コミット

## 2026-07-26 オンボーディングのUI/通信分離＋モックプレビュー新設

- 課題: dev サーバーは本番 Supabase＋実 Twilio に直結（.env.local が本番と同一 DB）のため、/join の通し実行での UIUX 反復は不向き
- `/join` を UI（`OnboardingWizard.tsx`）と通信（`WizardAdapter`）に分離。本番は realAdapter（挙動不変・tsc/テスト411 green）
- `/preview/onboarding` 新設: モック adapter 注入で SMS・DB・Passkey なしに全ステップを何度でも通せる。操作バー（招待リンク/コード手入力の切替・Face ID 失敗再現・最初からやり直す）付き。UI は本番と同一実装なので調整がそのまま /join に反映される
- migration 114/115 は本番適用済みと確認（ユーザー報告）

## 2026-07-26 氏名の姓名分割＋フリガナ・生年月日ピッカー化（バグ修正含む）

- **バグ修正**: 生年月日で「次へ」が押せない件。原因はハイフン自動挿入ではなく isPlausibleDob 内の `toISOString()`（UTC変換）で JST では正しい日付が常に1日ズレて不一致→全入力が弾かれていた。入力方式の刷新でバリデーション自体を撤去
- **生年月日**: 年・月・日の `<select>` 3分割に変更（iOS Safari は純正ホイールピッカーで開く）。月・年に応じて日数を調整、不正日付は構造的に入らない
- **氏名**: 姓・名の分割入力（表記揺れ防止・保存は「姓␣名」合成）＋フリガナ（セイ・メイ、ひらがな自動カタカナ化）。migration `116_identities_name_kana.sql` 新設、/api/join で nameKana 受領・保存。運営の承認/本人確認モーダルにフリガナ行を追加
- 検証: tsc クリーン / テスト 411 passed / preview 200 OK。**migration 116 は Supabase 未適用**・未コミット
- 氏名ステップの磨き込み: 補足文・プレースホルダの例をすべて削除、姓名・フリガナは下線のみのフィールドに変更（lineInputCls）
- 氏名フィールドをフローティングラベル化（下線のみ・フォーカス/入力で左上に縮小移動）＋行間の余白拡大
- フリガナ入力の IME バグ修正: 変換中は value を書き換えず composition 確定時のみカタカナ化。カタカナ以外はメッセージ表示（canProceed もカナ正規表現で判定）

## 2026-07-26 ウィザードUI統一・ガイド付き撮影・フリガナ自動入力

- **UI一貫性**: 全ステップで主ボタン全幅＋「戻る」は下のテキストリンク（FontAwesome chevron）に統一（横並び廃止）。全入力を下線スタイルに統一（電話・郵便番号・住所は FloatingLineField、OTP・参加コードも下線化）。電話のハイフン付きプレースホルダ廃止
- **免許有効期限**: 生年月日と同じ年月日ホイール（DateWheelField・下線 select）に変更。ホイールの途中選択も親 state（DateParts）で保持し、戻る→再訪でも消えない
- **Passkey 文言**: 「かんたんログインを設定」＋「この端末の顔認証・指紋認証（Face ID など）でそのままログインできます」に変更（パスワード言及を削除）
- **フリガナ自動入力（autokana）**: 姓・名の IME 変換前の読み（compositionupdate のひらがなスナップショット）を拾い、確定時にカナ欄へ自動追記。手動編集後は上書きしない・氏名クリアで自動分もクリア
- **ガイド付き撮影** `lib/components/GuidedKycPhoto.tsx` 新設: getUserMedia のページ内カメラに免許証カード枠（1.58:1）／顔の楕円ガイドを重ね、その場撮影限定。ミラー表示（顔）・シャッター・非対応環境は `<input capture>` フォールバック。/join の免許・顔ステップに適用
- 検証: tsc クリーン / テスト 411 passed / preview 200 OK
- パスキー設定画面に顔認証/指紋認証アイコン（faFaceSmile+CSSビューファインダー括弧の合成グリフ・faFingerprint）、免許ガイド枠内に氏名欄・有効期限帯・写真位置のヒントを追加
- 顔撮影ガイドを SVG に刷新: 点線の卵型（顎すぼまり）＋中心十字＋首・肩ライン（参考画像準拠・暗転なし）
- 免許証ガイドを実物レイアウトの線画SVGスケルトンに刷新（文字ラベル廃止・生年月日丸枠・種類の連結グリッド・写真枠に人型シルエット）

## 2026-07-26 住所ステップ改善＋免許ガイドの簡素化

- **住所ステップ**: 郵便番号欄を幅2/5に縮小、7桁入力で zipcloud（admin と同じAPI）から住所を自動入力（手動編集済みは上書きしない）。説明文を「運転免許証に記載の住所と同じです」チェック（既定ON）に置換え、申告値を drivers.address_matches_license に保存（migration 117）。運営の承認/本人確認モーダルに「免許記載と同一/異なる（本人申告）」を表示
- **免許ガイド刷新**: TRUSTDOCK 風に要素削減（交付行・条件・優良・番号を削除）、太線(2.5)＋角丸＋丸端で柔らかい線画に。氏名ピル＋生年月日ピル・住所2行箱・有効期限帯・左下連結段・種類グリッド・写真枠＋白抜き人型
- 検証: tsc クリーン / テスト 411 passed / preview 200 OK。**migration 117 は Supabase 未適用**
- 電話番号: 全角→半角自動変換＋携帯番号バリデーション（0[6789]0の11桁・不正時メッセージ）。OTP入力を6本の下線スロット化（透明input重ね・one-time-code自動入力対応・全角変換）。パスキー画面に PIN・パターングリフを追加（自前SVG）、文言を「画面ロック」ベースに
- パスキー設定失敗時のUXを刷新: 理由の列挙（WebAuthn仕様上判別不能）をやめ、「設定は完了しませんでした→今は設定せずに進む(主)／もう一度試す(副)」の導線に変更
- 申請完了画面を刷新: 緑チェック大アイコン＋「審査結果はアプリでお知らせ」＋ App Store/Google Play ボタン（NEXT_PUBLIC_APP_STORE_URL/PLAY_STORE_URL 未設定時は準備中表示）。SMS通知の虚偽文言・口座/業務開始の無関係文言を削除。OTPステップに SMS アイコン追加

## 2026-07-26 途中離脱対策と招待URLの情報漏れ防止

- **端末内ドラフト**: 申請確定（SMS認証）前の入力（姓名・カナ・生年月日・電話・同意）を localStorage（nippo_join_draft・24h失効）に自動保存し再訪時に復元。サーバには置かない＝同じ招待URLを別端末が開いても入力は見えない。申請確定で削除。プレビューは persistDraft=false で毎回まっさら
- **再訪時の表示**: 申請済み＋同一ブラウザ（セッション残存）で /join を再訪すると「アカウント開設の手続き中です」画面（緑チェック＋審査中案内＋ストアボタン）
- **招待URLの中立エラー**: 使用済み・失効・期限切れ・不正をすべて「この招待リンクは無効です」に統一（lookup・join両API）。「使用済み」を区別して返すと第三者に申請の存在が漏れるため
- 検証: tsc クリーン / テスト 411 passed / preview 200 OK
- ステップ再構成: 氏名＋生年月日を1ページ統合、KYC順を住所→免許→顔に変更（顔撮影で締め→申請完了）。パスキー成功はその場で「設定が完了しました」表示→1.2秒後に自動遷移（次ページの残留メッセージ廃止）

## 2026-07-26 遷移アニメーション・ラベル調整・実機TODO・コミット整理

- ステップ切替に既存 soft-rise（フェード＋上昇・reduced-motion対応）を適用（key={step}）
- 氏名・生年月日ページ: 「氏名」グループラベルを追加し、「氏名」「生年月日」「免許証の有効期限」のラベルを text-xs/slate-400 に統一（主張を抑える）
- **TODO(スマホ実機で要調整)** を GuidedKycPhoto に明記: PCでは画角が広く免許証が保存画像のごく一部になる（ガイド枠クロップ or zoom constraints を検討）／顔ガイドSVGがPCでは小さい／実機確認は HTTPS 必須
- ここまでの作業を機能単位で5コミットに分割（db / api / web wizard / admin+mobile / docs）

## 2026-07-26 招待リンクUIの封印（準備中）とマージ準備

- 単回招待リンクの発行UIを NEXT_PUBLIC_INVITE_LINKS_ENABLED=1 で解放するフラグ制に（既定は非表示・API は実装済みのまま）。非表示時は共有参加コードセクションが従来の見出し/説明に戻る。手動追加（/admin/users）は従来どおり併存
- 申請完了画面: ストアURL未設定（アプリ未公開）の間は「アプリでお知らせ」ではなく「審査の結果は運営からご連絡します」「アプリは近日公開予定」の正直な文言に自動切替
- migration 114〜117 はすべて本番適用済み（ユーザー確認）
- 検証: web/mobile tsc クリーン・テスト411 passed → main へマージ
- main へ --no-ff マージ（6338fc3）し origin へ push（Vercel 本番デプロイ）。招待リンクUIは封印済み・共有コード＋手動追加の現行運用は不変

## 2026-07-26 実機修正: カメラモーダルを portal で全画面化

- 実機でカメラが狭く表示される件: ステップ切替アニメーション（transform）を持つ祖先内の fixed が祖先基準になっていたのが原因。CameraModal を createPortal(document.body) 直下に描画＋100dvh 指定で全画面化
- 検証: web tsc クリーン。実機確認継続中

## 2026-07-26 実機修正: 縦スクロール抑制・autoFocus 廃止

- ルートを min-h-[100dvh] に変更（100vh がアドレスバー分はみ出して常にスクロール可能になる問題を解消）＋ overscrollBehaviorY:none で引っ張りバウンス抑制（マウント中のみ・復元あり）
- 全ステップの autoFocus を廃止（表示直後にキーボードが出て戸惑うため、タップで入力開始）
- 検証: web tsc クリーン / テスト 411 passed

## 2026-07-26 免許有効期限のOCRプリフィル（web）

- tesseract.js v7（クライアント完結・動的import・初回のみCDNから数MB取得）で免許写真から有効期限を読み取り、未入力ならホイールへ自動入力＋「写真から自動入力しました」の案内。手入力済みは上書きしない・失敗は無言
- パースは純関数 lib/ocr/parseLicenseExpiry: 西暦/和暦（令和・平成・元年）・全角/空白ゆらぎ対応、「まで」優先＋日付範囲で交付日/生年月日を除外。vitest 10件追加
- 検証: tsc クリーン / テスト 421 passed（411→421）
- 残課題: 実機での読み取り精度確認（広角画像だと精度が落ちる可能性→ガイド枠クロップ導入時に改善見込み）

## 2026-07-26 OCRプリフィル不発の修正・ガイド枠クロップ・NFCメモ

- バグ修正: OCR結果の反映が state 更新関数内フラグ（非同期実行のため直後に読めない）に依存していて実行されなかった → licensePartsRef で同期判定に変更。読めなかった場合は「写真から読み取れませんでした」を控えめに表示
- 免許撮影をガイド枠＋6%余白で切り抜き保存（object-cover の座標変換込み）。確認画像・運営レビュー・OCR精度がまとめて改善。顔は全体保存のまま
- 仕様書にマイナ免許証/IC読み取りメモ（web不可・モバイル+SDKで将来検討）と氏名住所OCR不採用の理由を記録
- 検証: tsc クリーン / テスト 421 passed

## 2026-07-27 進捗整理: ロードマップにトラックJ（オンボーディング）を追加

- docs/roadmap-2026-07.md に J トラックを追記（完了内容と残タスク: 招待UI解放フラグ・実機追い込み・承認時通知・規約レビュー・電子契約・NFC将来）
- 次の主戦場は mobile（トラックD・9/1 目標。Apple は 8/8 登記待ちのため Android/足回り/SDK57 判断が先行可能）

## 2026-07-27 Expo SDK 57 移行（夜間自律作業・feat/expo-sdk57 ブランチ）

- **調査**: SDK 57 = RN 0.86 / React 19.2（53〜56 の累積が実質: New Arch 必須化・Hermes V1 既定・reanimated 4）。NativeWind v5（Tailwind v4 対応）は preview 段階 → **Tailwind v4 化は見送り、NativeWind 4.2.6 + Tailwind v3 で SDK 57 化のみ実施**
- **React 19.2.3 に monorepo 一本化**: 混在の根本原因は root package.json に残置された expo52/react18/RN0.76 の直接依存。除去＋overrides で単一コピー化し、web 側の回避策（tsconfig paths・vitest alias）を撤去。AGENTS.md・patterns/mixed-react-monorepo.md に解消記録
- **機械的修正**: app.json の newArchEnabled 削除・deploymentTarget 16.4、@types/react 19・TS 6.0、css-interop 0.2 型参照、safe-area className 型拡張、*.css スタブ
- **検証（すべて green）**: mobile/web tsc・web テスト421・next build・expo export（iOS/Android Hermes バンドル）・prebuild --clean・pod install（GoogleMLKit 8.0.0）・**xcodebuild シミュレータビルド成功**。expo-doctor 19/20（ML Kit「New Arch 未テスト」表記のみ＝現行アプリで稼働実績あり）
- **残（要ユーザー）**: 実機 dev client 再ビルドで動作確認（生体ロック・カメラ・OCR・NativeWind描画）／Android ネイティブビルド（ローカルに JDK/SDK なし→EAS）／bundleId 確定（提案: jp.hakotora.app）。main 未マージ

## 2026-07-27 bundleId 確定: jp.hakotora.app

- ユーザー決定により iOS bundleIdentifier / Android package を jp.hakotora.app に変更（com.example.nippomobile から本番化）。name/slug は EAS 設定時に確定
- prebuild --clean で両ネイティブ再生成・pod install 完了。新IDでの iOS シミュレータビルドも BUILD SUCCEEDED（xcodebuild・全ネイティブ再コンパイル）
- 残: Apple Developer 登録後に本IDで App ID 登録＋Associated Domains（Passkey AASA）

## 2026-07-28 シフト画面の車両貸出を can_manage_vehicles でも操作可能に

- 貸出切替（シフト画面の車両貸出表）は従来 can_dispatch のみでゲートしていたが、「車両を操作する権限（can_manage_vehicles）」でも可能に変更（配車 or 車両管理のどちらかで許可）
- サーバー: auth/permissions.ts に requireAnyPermission（いずれか1つで許可）を追加し、/api/admin/shifts/vehicle-loans を ["can_dispatch", "can_manage_vehicles"] でゲート
- UI: shifts/page.tsx に canManageVehicles を追加し canLoan = canDispatch || canManageVehicles で貸出表ボタン・startLoanPaint・toggleVehicleLoan・自動保存表示を制御。車両割当（配車）は従来どおり can_dispatch のみ
- capabilities.ts の説明文更新（車両の管理に貸出切替を含む旨を権限設定UIにも反映）
- 検証: tsc クリーン / auth テスト 24 passed

## 2026-07-28 調査: hakotora.jp への利用ドメイン移行状況

- アプリ側にはログイン時のホスト記録なし（DB に last_login やドメイン情報を持たない）→ アプリのデータからは判別不可
- Vercel ランタイムログ（`vercel logs --json`）には `domain` フィールドがあり判別可能。直近約1.5時間（09:23〜10:50）の100件では、ユーザー起点のリクエストは全て hakotora.jp（admin のポーリング API 含む）。nippo-*.vercel.app へのアクセスは cron の自己呼び出し2件のみ
- 旧→新ドメインのリダイレクトは未設定（vercel.json / next.config とも）。localStorage トークンは origin 単位のため、旧ドメイン利用者は移行時に再ログインが必要になる点に注意

## 2026-07-29 地図（ベータ）: Mapbox 導入・車両の最終確認位置＋プレート吹き出し

- mapbox-gl 3.27 を apps/web に導入。管理メニューに「地図」（βバッジ付き・cap=can_view_vehicles）を追加（AdminLayout に beta フラグと BetaBadge を実装）
- 新ページ `(admin)/admin/(ops)/map/page.tsx`: Mapbox GL（streets-v12・日本語ラベル）に車両マーカーを表示。マーカータップで吹き出しに VehiclePlate（ナンバープレート）＋状態（稼働中=緑/退勤済み=グレー・打刻時刻）を表示。60秒自動更新・初回 fitBounds
- 新 API `/api/admin/map/vehicles`（can_view_vehicles・org スコープ）: 位置ソースは vehicle_sessions の打刻GPS。車両ごとに最新の座標付きセッションを採用（closed は退勤地点優先→出勤地点、GPS無しセッションは遡ってスキップ）。位置なし車両は position:null（ページ側で件数表示）
- トークンは NEXT_PUBLIC_MAPBOX_TOKEN（.env.local に設定済み・gitignore 対象）。未設定時はページ内に設定案内を表示。**Vercel 本番の環境変数は未設定（要作業）**
- 検証: tsc クリーン / テスト 421 passed / next build 成功。実データ（打刻GPS）での表示確認は未実施

## 2026-07-29 feat/expo-sdk57 を main にマージ・push

- マージコミット ed39345（--no-ff）。SDK 57 / RN 0.86 / React 19.2 一本化・bundleId=jp.hakotora.app に加え、地図ベータ（Mapbox）・車両貸出の can_manage_vehicles 対応も本番へ
- 注意: モバイルの実機確認は未実施のままのマージ（ユーザー判断）。web は tsc/テスト421/next build 検証済み
- 残: Vercel 本番 env に NEXT_PUBLIC_MAPBOX_TOKEN 未設定（地図ページは設定案内の表示になる）

## 2026-07-29 調査: オイル交換報告の車両取り違え（6290選択→6318で記録）

- 事象: 7/29 17:41 の報告（勝政さん）が vehicle_id=6318 で記録。本人の選択は 6290。preference は 18:59 に 6290 へ更新されている（選び直しの形跡）
- 原因（コード）: me/page.tsx の vehBundle 同期 effect が、SWR の再検証（再マウント時の stale 再取得・reconnect）で発火するたびに selectedVehicleId を「保存済み preference」へ**リセット**する。ユーザーがタップ選択→preference PUT が完了する前に GET が走ると、旧 preference（6318）に選択が巻き戻る。カルーセルは10台表示で 6318 は7番目＝画面外のため、ハイライト移動に気づけない
- 6318 が旧 preference だった理由: 前日 7/28 23:19 の報告も 6318 で記録され、送信成功時に saveVehiclePreference(6318) が走るため
- 対処案（未実施）: effect では「初期化のみ」（selectedVehicleId が null のときだけ resolve を適用）にし、ユーザー選択を裏更新で上書きしない。モーダル追加車両も setVehicles での丸ごと置換で消えるため merge にする

## 2026-07-29 オイル交換報告: 「最後に選んだ車両」廃止・データ修正準備・地図の帰属表示

- me/page.tsx（諸報告）から vehicle-preference の取得・保存を全廃。実施車両は毎回タップで明示選択（自動選択なし）。vehBundle 同期 effect は選択状態に触れず、モーダル追加車両も裏更新で消えないよう merge に変更（車両取り違えバグの根治）
- /submit（日報）は preference を使い続ける（同型の上書き effect があるため、同種の事故が出るなら同様の見直しが必要）
- データ修正はスクリプト src/scripts/fix-oil-vehicle-20260729.ts に用意（報告2件を6290へ・6318の last_oil_change_mileage を150423へ復旧・6290へ145765を適用）。**本番書き込みが権限で止められたため未実行**（ユーザー実行待ち）
- 地図: Mapbox の帰属表示（ロゴ・©・Improve this map）は規約上必須で削除不可。attribution をコンパクト表示（ⓘ）に変更
- 検証: tsc クリーン / テスト 421 passed

## 2026-07-29 オイル交換データ修正の実行完了

- ユーザー実行により fix-oil-vehicle-20260729.ts を適用: 報告2件（7/28・7/29）を 6290 へ付け替え、6290 の前回オイル交換=145765km、6318 は 150423km に復旧。スクリプトは実行済みのため削除

## 2026-07-29 地図ベータ: 3D表示・カメラ操作の実験

- 地図ページのスタイルを streets-v12 → Mapbox Standard に変更（3D建物・ランドマーク・時間帯ライティング内蔵、mapbox-gl v3.27）
- 「3D で見る / 2D に戻す」トグル追加（easeTo で pitch 62°・bearing -18° へアニメーション）
- 時間帯ライティング切替（朝/dawn・昼/day・夕/dusk・夜/night）を setConfigProperty("basemap", "lightPreset") で追加
- NavigationControl のコンパスを有効化（visualizePitch）。右ドラッグ/Ctrl+ドラッグで回転・傾き操作可
- 検証: tsc クリーン

## 2026-07-29 地図ベータ: 拠点マーカー4件と選択ズーム

- 固定拠点マーカー（紫）を追加: Amazon DOO4 大阪枚方DS / 車屋さん（らいとすたっふ）/ アリビオ東寺 / サンパルク伏見桃山駐車場（12番）
- 座標は Mapbox Geocoding v6（番地レベル）。サンパルクのみ Mapbox 未収録のため国土地理院住所検索の26番地の値
- 地図左上に「拠点」セレクタを追加。押すと flyTo（zoom 16.5）で移動し吹き出しを開く。他拠点の吹き出しは閉じる
- 検証: tsc クリーン
- 追記: サンパルク伏見桃山の座標を Google マップ実測値 [135.7594225, 34.9454160] に修正（地理院値から約50m ズレていたため）

## 2026-07-29 地図ベータ: 視点操作の改善（トグル同期・角度スライダー・自動ライティング）

- 時間帯ライティングを手動ボタン→現在時刻から自動に変更（5-8時=朝/8-16時=昼/16-19時=夕/以降=夜、10分ごと再判定）。現在値は左上に表示のみ
- 2D/3D をセグメントトグル化し、状態を地図の実ピッチから導出（pitch イベントで同期）。コンパスクリックで2Dに戻ってもトグル表示が追従する
- 角度スライダー（0〜85°）を追加。maxPitch を85に拡大し、easeTo は pitch のみ変更（bearing はユーザー操作を尊重）
- 検証: tsc クリーン
- 追記(7/30): ライティング表示バッジと角度スライダーを削除。代わりに Option+スクロールのカメラ操作を追加（縦=傾き 0-85°/横=方角、capture でズームより先取り）。パネルは 2D/3D セグメントトグルのみに
- 追記(7/30): 吹き出しの×ボタンを廃止（closeButton: false、地図クリックで閉じる）・角丸12pxに（globals.css で .mapboxgl-popup-content を上書き）
- 追記(7/30): 3Dモデル実験 — サンパルク駐車場脇にトラック glb を1台配置（mapbox-gl v3 の model レイヤー + map.addModel、外部ライブラリ不要）。モデルは Khronos サンプルの Cesium Milk Truck（CC-BY 4.0）を public/models/truck.glb に配置。本採用時は実車系 glb に差し替え＋帰属表記を検討
- 追記(7/30): トラックモデルを夜でも視認できるよう自己発光（model-emissive-strength: 1）に。見かけサイズをズーム非依存に（zoom イベントで model-scale を 2^(18-zoom) に逆補正、zoom10 で打ち切り）。参考モックのダッシュボード地図のスケール感に合わせた
- 追記(7/30): トラック頭上に VehiclePlate(compact) のナンバープレートラベルを配置（Marker anchor:bottom、デモ値 京都400あ12-34）。モデルの見かけサイズを1.6倍に拡大。拠点パネルに目アイコンの表示/非表示トグルを追加（非表示時は吹き出しも閉じる）
- 追記(7/30): 車両/拠点のズーム役割分担 — 拠点ピンはズーム14.5以上でフェードアウト（opacity 300ms、手動トグルとAND条件。吹き出しは flyTo の行き先表示のため手動トグル時のみ閉じる）。プレートを吹き出し型 VehicleLabel に刷新（通常版 VehiclePlate を92px容器で描画=文字比率改善・稼働中/退勤済みの状態行・下向き尻尾）。複数台時のプレート重なり回避（moveend で画面座標の衝突判定→上に積む declutter）を実装
- 追記(7/30): プレート吹き出しを黒（slate-950）基調に。拠点ピン再表示バグ修正 — mapbox v3 の Marker は3D遮蔽判定で element の opacity を毎フレーム上書きするため、opacity でなく visibility で非表示制御するよう変更。zoom リスナーは ref 経由で最新関数を呼ぶ形に。マーカーの重なり順を zIndex で固定（拠点1 < 車両2 < プレート5）。基図の情報量削減 — Standard の config で POI・道路名・交通ラベルを非表示（地名のみ残す）

## 2026-07-30 地図ベータ: 拠点ピンのDB化・設定モーダル・プレート吹き出し刷新

- 拠点ピンをハードコード廃止→DB保存に: migration 118_map_places（org単位、name/lat/lng/icon）、API GET/POST（can_view_vehicles / can_manage_org_settings）・DELETE（org スコープ強制）
- 地図左上の拠点パネル廃止→歯車ボタンの設定モーダルへ: 表示トグル（基本非表示・デフォルトOFF）、一覧（名称タップで flyTo・ゴミ箱で削除 ConfirmDialog）、「地図にピンを打って追加」（クリック→名称＋種別4択 pin/warehouse/parking/client→保存。Esc中止）
- 拠点マーカーは種別アイコンの丸バッジ（白縁・色分け）。popup 名称は textContent 挿入（XSS回避）
- プレート吹き出しを VehiclePlate 流用から専用 VehicleLabel に刷新: 黒ナンバー風（黒地×黄文字 #e8d44d、金枠・ボルト装飾なし）＋稼働状態行
- **migration 118 は未適用**: .env.local の SUPABASE_DB_URL が消滅済みの旧プロジェクト（wdbifbzwxivgefyxpzbi）を指しており接続不可。アプリ本体は ooirajiizydcynyglvuv（REST）を使用中 → ユーザーが Supabase SQL Editor 等で 118 を適用する必要あり。SUPABASE_DB_URL の更新も要検討
- ナンバープレート文字の SVG グリフ化ほか継続タスクを docs/roadmap-2026-07.md の「K. 地図ベータの継続改善」に記録
- 検証: tsc クリーン

## 2026-07-30 地図ベータ: 表示設定・デモ車両10台・ピン/車サイズ調整

- 設定モーダルに「地図の表示」を追加（localStorage 保存 hakotora_map_view_prefs）: ベースマップ 標準/航空写真（standard ⇔ standard-satellite を setStyle で切替、style.load で全設定再適用）・地名/道路名/施設名/交通機関のラベル4トグル・3D建物（航空写真では無効化）・3D地形（mapbox-dem, exaggeration 1.2）
- 拠点ピンのズーム連動自動非表示を廃止（消えるのが早すぎるため。手動トグルのみに）
- トラックの見かけサイズ調整: 基準を実寸2倍に拡大、ズーム18以上は縮小せず実寸連動（近接で豆粒になる問題の修正）、ズーム9未満で拡大打ち切り
- デモ車両10台を京都市内に配置（DEMO_VEHICLES: 3Dモデルは1ソース+model-rotation データ駆動、プレート吹き出しは稼働中/積み込み中/休憩中/稼働外の4状態を色分け表示）
- 「位置情報のある車両がまだありません」バナーを削除（ユーザー要望）
- 検証: tsc クリーン
- 追記: 車と吹き出しの距離ズレを根治 — 原因は glb のモデル原点が車体中心から外れていたこと（スケールが原点基準のため、ズームアウト拡大時に車体が原点から流されて描画される）。gltf-transform center --pivot below で原点を底面中心に修正。吹き出しオフセットは基本30px・ズーム18以降はトラックの実寸連動拡大に合わせて倍率追従。declutter を zoom イベントでも再計算
- 追記: デモ車両v01をサンパルク実測座標に一致させた。駐車の忠実再現（区画スナップ＋向き）の設計方針を回答 — 駐車区画マスタ（アンカー座標+heading）を持ち、打刻GPSではなく区画に吸着させる。ロードマップ I（駐車位置の記録）と接続する構想
- 追記: 車両モデルを Kenney Car Kit の delivery van（CC0）に差し替え。実寸3.25×1.5×1.65mで軽バン同寸・原点底面中心・テクスチャ埋め込み済み（外部参照だったため gltf-transform copy でパック）。スケールは引きで1.6倍・ズーム18.7以降は等倍固定（駐車区画に正しく収まる）。吹き出しオフセットは車両の画面上高さに比例
- 追記: プレート吹き出しの重なり処理を「上に積む」→「その場表示・被ったら画面下側（手前）の車両のみ表示」に変更（ズームでの飛び跳ね解消。ユーザー指定のUX）
- 追記: 軽バンが描画されない問題を修正 — glb の KHR_texture_transform が {texCoord:0} のみ（offset/scale なし）で、mapbox-gl のローダーが offset[0] を無条件参照して落ちていた。no-op 拡張のため glb から除去して再構築（validate クリーン）
- 追記: 軽バン不表示の根本原因を Chrome 実機デバッグで特定（認証不要の一時ページ public/model-test.html を作り console/network を確認→削除済み）。glb 読み込み失敗の実体は RangeError: offset is out of bounds — mapbox-gl の model ローダーは①頂点バッファのインターリーブ形式（stride=48）②ubyte インデックスに非対応。gltf-transform optimize --vertex-layout separate で分離レイアウト・ushort 化して解決（112KB に減量）。実機で描画確認済み。ついでに hakotora dev は :3001 で稼働（:3000 は別プロジェクト opscore）と判明
- 追記: 吹き出しの縮退表示を実装 — 重なりで負けた側は非表示でなく状態色ドット（白縁3px）に縮退（globals.css の .vehicle-label / .vl-collapsed）。台数の誤認と表示の揺れを解消

## 2026-07-30 ナビ: 勤怠・通知配信に β バッジ追加

- AdminLayout.tsx の navItems で「勤怠」「通知配信」に beta: true を付与（地図と同じ BetaBadge 表示）

## 2026-07-31 00:50 mobile 業務ホーム再設計(進行中)+シミュレータ環境の復旧

- 設計決定(ユーザーと合意):
  - 日報はタブ分離せず**退勤フローに統合**(退勤時に送信)。ホーム終了後状態に「日報を書く・修正する」の再送導線
  - 業務ホームは3状態(待機=今日のシフト/稼働中=経過時間・車両/終了後=稼働時間・距離サマリー)。円形ボタン中心
  - 円形カメラ演出の是非を議論中: 指の真下カメラ化の不自然さ+撮影UI4種バラバラ問題 → **案A=統一フルスクリーンキャプチャフロー**(QR→メーター→点検を一筆書き、円はトリガー+状態アンカーに徹する)を提案、返答待ち
- 実装: DailyReportForm を WorkScreen から切り出し(imperative handle で外部 submit 可)、BottomSheet に scrollable 対応、WorkScreen を3状態ホーム+退勤2ステップ(車両記録→日報)に書き換え。tsc クリーン
- シミュレータ復旧(Xcode 26.6 環境):
  - 白画面の原因: インストール済み dev client が **6/24 の SDK52 製**で SDK57 JS と不整合(7/27 の sim ビルドは「ビルド成功」のみで未インストールだった)
  - xcodebuild がシミュレータ destination を列挙できない → generic destination + simctl install で回避
  - ML Kit (GoogleMLKit 8.0.0) が simulator-arm64 非対応(EXCLUDED_ARCHS=arm64 持ち込み)。x86_64 は iOS 26 ランタイムが拒否(Rosetta 廃止)。ld_classic でも突破不可
  - 対処: **一時的に @react-native-ml-kit/text-recognition を expo autolinking から除外**して arm64 sim 用 dev client をビルド(OCR は sim でテスト不能なので影響なし。import は呼び出し時のみ throw する安全な実装を確認済み)。**ビルド後に package.json と Pods を復元すること**(実機/EAS ビルドに影響させない)

## 2026-07-31 01:00 mobile: SDK57 dev client 稼働確認・ログイン画面ロゴ差し替え

- ML Kit 除外の arm64 dev client を iOS 26.5 シミュレータで起動し **SDK57 で描画確認**(ログイン画面表示・Fast Refresh 動作)。package.json / Pods は復元済み(git 差分なし)
- ログイン画面のロゴを アイコン+テキスト → **文字・タグライン入りプライマリロゴ**に差し替え(ユーザー指摘)。`apps/web/public/logo/hakotora-logo_primary_logo.svg` を rsvg-convert で PNG 化し `apps/mobile/assets/logo-primary.png` に追加
- dev ログインの調査: dev DB のドライバーコードは ACE 始まり(AAA 不在)。mobile の会社コードは EXPO_PUBLIC_COMPANY_CODE=AAA のため要変更。PIN 設定は dev DB 書き込みになるためユーザー確認待ち(電話OTPログインの可否も提示)
- 残: ログイン後の新・業務ホーム(3状態)の実機確認、案A(統一キャプチャフロー)の判断待ち、mobile への passkey ログイン導入は未実装(webのみ)

## 2026-07-31 01:10 mobile ログイン整備: 9桁コード直接入力・エラー文言・dev環境切替

- ユーザー指摘対応: ①PIN ログインの font-mono(iOS で細い Courier)を semibold に ②ログインAPIの生DBエラー露出(「データベースエラー: TypeError: fetch failed」)を一般文言化(詳細は console.error のみ) ③会社コード+6桁の分割入力を廃止し**9桁ドライバーコード直接入力**に(EXPO_PUBLIC_COMPANY_CODE を .env からも削除。web 側の COMPANY_CODE 概念の完全撤廃は別課題)
- 真因判明: **dev Vercel (hakotora-dev) の Supabase 接続が旧プロジェクトのまま死んでいる**(login POST が fetch failed)。mobile の API 先をローカル :3001 に変更(apps/web/.env.local の新 dev Supabase を使用)。**dev Vercel の env 修復が残課題**
- dev ログイン用データ(dev DB のみ・ユーザー承認済み): ACE800013 に pin_hash=bcrypt("123456")・kyc_verified_at・住所/写真ダミーを設定 → ローカルAPIで complete/kycVerified 両ゲート通過を確認
- ログイン画面ロゴをプライマリロゴ(文字+タグライン入り)に差し替え済み。シミュレータで表示確認

## 2026-07-31 01:15 mobile: 通知タブ追加(5タブ化)・カレンダー土曜折返しバグ修正

- 下タブのバランス改善(ユーザー指摘): 「通知」タブを追加し5タブ化 [マイページ/希望休/●業務/通知/報酬]。中央円が真ん中に。初期タブを業務に変更
- 通知インボックス画面を新規作成(NotificationsScreen)。GET/PATCH /api/me/notifications、未読ドット・タップ既読+展開・すべて既読・pull-to-refresh。ロードマップ「mobile にインボックス無し」の穴埋め
- シフトカレンダーの実バグ修正: w-[14.2857%]×7 の flex-wrap が Yoga の丸めで7列目(土曜)を折り返し、全日付が1つずれて見えていた。月カレンダー・希望休グリッドとも「週ごと flex-row + flex-1」方式に変更(buildWeeks ヘルパー)
- 検証: mobile tsc クリーン、シミュレータで5タブ・新ホーム(待機状態)表示確認

## 2026-07-31 01:25 mobile: タブ3つに再編・カレンダー罫線の最終修正

- タブ再編(ユーザー方針「業務以外はぜんぶ自分のこと」): 5タブ→**3タブ** [シフト/●業務/報酬]。マイページ・通知はホーム右上のベル/人型アイコンから native-stack で開く(未読ドット付き。focus で未読数更新)。初期タブ=業務
- カレンダー罫線ずれの追修正: flex-1 等分配は空セルと内容ありセルで Yoga の割付が行ごとにずれるため、**全セル width:14.2857% 明示指定**に変更(月カレンダー・希望休・曜日ヘッダーとも)
- ホーム設計の合意: スケッチ準拠で P1=ヒーローカード(バン事前レンダ画像+reanimated箱アニメ)+Spotify型業務中モード(Context化+ミニバー) / P2=バックグラウンド位置トラッキング(地図ベータ実データ化と接続) / P3=Live Activity(eas整備後)。リアルタイム3Dは不採用(ネイティブ依存・電池に見合わない)
- 検証: tsc クリーン・シミュレータで3タブ+ヘッダーアイコン表示確認

## 2026-07-31 01:40 mobile P1: タブレス化・スケッチ準拠ホーム・月スワイプ+年月ピッカー

- **タブバー廃止**(ユーザー決定): ドライバーモードはホーム1画面+native-stack遷移に。ヒーローカード(挨拶+今日のシフト+シフト確認導線)/アンバー稼働開始カード(円は hand-pointer アイコン化、iconOnly/showCaption プロパティ追加)/お知らせ最新3件/クイックアクセス(シフト・報酬)。スケッチ(Anchor 80D8B2CF)準拠
- **月ナビ共通部品 MonthPager/MonthTitle/MonthPickerSheet 新設**: 前月翌月ボタン廃止→横スワイプ月送り(3ページ窓・RN標準ScrollViewのみ)+タイトルタップで年月ピッカー。シフト確認(月キャッシュ付きShiftMonthGrid)・希望休・報酬(RewardsMonthContent切り出し)の3画面に適用
- 希望休グリッド崩れの修正(COL幅の適用漏れ)。App.tsx 三項演算子内のJSXコメントによる SyntaxError も修正
- ModeSwitchFab をタブバー分の余白から bottom+16 に
- 検証: tsc クリーン・シミュレータでホーム/構成確認。※この dev client は HMR が繋がらず変更反映は再起動が必要
- P1残: ①バン画像(GLBレンダ)+箱アニメ ②Spotify型業務中モード ③案A全画面カメラ

## 2026-07-31 12:40 web: シフト表AI取り込み(ハコ虎AI 初弾)

- 取引先から届くシフト表(PDF/画像/スプシのスクショ。形式は完全に不統一)を読み取り、シフト管理画面に一括登録する機能を実装。対象例: 豊中Amazon(行=日付)、TWC吉祥院・上鳥羽(行=人)、枚方ミッドナイト(〇/休)、上京・壬生(スクショ3分割)
- AI基盤 `apps/web/src/server/ai/client.ts` 新設(ハコ虎AIの束縛点)。@anthropic-ai/sdk + openai を追加、キーは ANTHROPIC_API_KEY / OPENAI_API_KEY(.env.local に枠を追記、**キー値は未設定=要発行**)
- 抽出 `server/ai/shiftImport.ts`: claude-opus-5 の vision + structured outputs で「人×日×セル表記」をファイル毎に並列抽出 → 分割スクショを名前×日でマージ → 姓のみ表記のドライバー候補/ラベル→コース候補を決定的にサジェスト
- API: `POST /api/admin/shifts/import`(can_manage_shifts、multipart、読み取りのみ) / `POST /api/admin/shifts/import/apply`(一括insert。slot自動採番・**既存割当は上書きせずスキップ**・休は行を作らない既存モデル準拠)
- UI: シフト管理ツールバーに「取り込み」ボタン+ShiftImportModal(ファイル選択→ラベル/人名マッピング確認→一括登録→結果表示)
- 検証: tsc クリーン。実ファイルでのE2E確認は APIキー設定後(202608-1 フォルダの7ファイルで試す)

## 2026-07-31 12:55 web: シフト取り込みの入口をドラッグ&ドロップに変更

- ユーザー要望: 新ボタンではなく「画面に直接ドロップ→被さるドロップフィールド出現」の形に。ツールバーの「取り込み」ボタンは撤去
- シフト管理画面の window に dragenter/over/leave/drop リスナ(canWrite時のみ)。ドラッグ中は全画面オーバーレイ(pointer-events:none、dropはwindowが受ける)。ドロップでモーダルが開きファイルが積まれる
- モーダルはファイル状態を親(page)持ちに変更(モーダル表示中の追いドロップも同じ経路で合流)。個別削除×・重複合流(name+size+mtime)・拡張子フォールバック判定を追加
- 検証: tsc クリーン

## 2026-07-31 13:30 web: シフト取り込みの信頼性強化(検算・取り消し・プレビュー・辞書・人違い検出)

- ユーザー要望の5点をフル実装。あわせてモデル既定を claude-sonnet-5 に変更(コスト優先。HAKOTORA_AI_MODEL で claude-opus-5 等に切替可)
- **①集計検算**: 資料内の「出勤日数」「◯◯人数」も抽出し、読み取り結果の再集計と突き合わせ(日別/人別の一致数と不一致リストをモーダル表示)
- **⑤バッチ取り消し**: migration 119(shift_import_batches + shifts.import_batch_id + 辞書2表)。apply でバッチ記録、revert API で一括削除。モーダルに「直近の取り込み」一覧+取り消しボタン。**119未適用でも動くフォールバック**(バッチ無しで登録継続)
- **③グリッドプレビュー**: 登録前に人×日のマトリクス(コース色付き)で表示。休/未マッピング(黄)/重複除外(赤)を色分け
- **④辞書**: 確定した 名前→ドライバー / ラベル→コース を保存し、次回は「前回と同じ」バッジ付きで初期値に(AI推測より優先)
- **②突き合わせ+人違い解決**(ユーザー指定ロジック): 担当コースは必ず登録されている前提で、担当外コースへの割当=人違い警告。同日2コース衝突は 担当コース優先→過去35日+当月の実績頻度 で最尤を自動採用、確信が持てない場合は【要確認】警告。希望休(全休)との矛盾も警告
- 判明: **SUPABASE_DB_URL が旧プロジェクト(wdbifbzwxivgefyxpzbi=tenant not found)のままで migration 118/119 が適用不能**。新devプロジェクトの Session pooler 接続文字列への差し替えが必要(ユーザー作業)
- 検証: tsc クリーン。実ファイルでの精度確認はユーザーが実施予定(APIキー取得済み)

## 2026-07-31 13:50 web: シフト取り込みの実運用フィードバック反映(初回実ファイルテスト後)

- ユーザーが実ファイル(202608-1)で初回テスト。スクショ2枚のフィードバックを反映
- **「休」と出勤の競合扱いを廃止**: マージ規則を「どこかのファイルで出勤なら出勤(休・空欄は黙って負ける)。競合警告は出勤vs別の出勤のみ」に。どのファイルにも無ければ暫定休み(行を作らない=従来どおり)
- **情報量の削減**: 検算不一致・読み取り注意を折りたたみ(details)に。出勤日数検算とファイル間競合は「ドライバーに紐付けた人」だけ表示(未登録の四方などのズレは非表示)。半月注記は1回だけ
- **「〇」等の文脈依存ラベルの自動候補**: 抽出時に登録済みコース一覧+ファイル名をプロンプトに渡し、ラベル→コースのAI推定(labelGuesses)を出力させる。候補優先度は 確定辞書 > 名称一致 > AI推定(枚方ミッドナイトの「〇」→ Amazonミッドナイト が初期選択されるように)
- 検証: tsc クリーン。次回の実ファイル再テストで「〇」の初期マッピングと警告量を確認

## 2026-07-31 14:05 web: シフト取り込みの期間ガード(違う月のファイルを弾く3層チェック)

- ユーザー指摘: 違う月のファイルを誤アップした場合、現状は選択中の月にそのまま入ってしまう(自動で正しい月には行かない)。API・時間を無駄にしない弾みが欲しい
- **層1 ファイル名(無料・即時)**: guessPeriodFromFilename(「8月前半」「2026.8.1-8.15」「202608」対応)。取り込み先とズレたら読み取り開始をブロックし、「取り込み先を◯月に変更」(setYearMonth連動) / 「このまま読み取る」(強行)の2択を提示
- **層2 表内の年月(API消費最小)**: 抽出スキーマに period(表・ファイル名に明記の年月)を追加。プロンプトで「明らかに違う月なら people 等は空で period だけ返して終了」と指示 → サーバーでそのファイルを除外しエラー文言表示
- **層3 曜日照合(年月未記載でも検出)**: weekdays(曜日行)を抽出し対象月のカレンダーと突き合わせ。3件以上あり過半数ズレなら「別の月の表」として除外
- 検証: tsc クリーン

## 2026-07-31 14:15 web: 取り込み小改善(年なし「◯月」ファイルの年推定)

- ユーザー情報: シフト表の作成サイクルは「月中14〜15日頃に後半分・月末に翌月前半分」。これを踏まえ、ファイル名に年が無い「◯月」表記の年推定を「今日に近い月(未来寄り)」に変更(12月末の「1月前半」→ 翌年1月)

## 2026-07-31 単回招待リンクUIの封印解除（ローカル）

- 調査結論: 招待URL(`/join?invite=<token>`)は元々 web 完結設計で、モバイルは案内テキストのみ（deep link 不要が明示決定）。発行API・検証API・`invites` テーブル(migration 114)・`/join` ウィザードの受け口・ドライバー登録(`POST /api/join` → drivers に pending insert)まで全部実装済みで、封印は `NEXT_PUBLIC_INVITE_LINKS_ENABLED` フロントフラグのみ
- `apps/web/.env.local` に `NEXT_PUBLIC_INVITE_LINKS_ENABLED=1` を追加（ローカル解放）
- 本番: Vercel production への同フラグ追加は権限制約でエージェント実行不可 → ユーザー操作待ち（`vercel env add NEXT_PUBLIC_INVITE_LINKS_ENABLED production` → 値 `1` → 再デプロイ。NEXT_PUBLIC 系はビルド時埋め込みのため再デプロイ必須）
