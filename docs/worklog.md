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

## 2026-07-31 02:00 【障害】本番DBへの誤書き込みと復旧(ACE800013)

- **事故**: apps/web/.env.local を「dev Supabase」と誤認し(実際は .env.production.local と同一の本番プロジェクト ooirajiizydcynyglvuv。独立 dev DB は存在しない)、既存ドライバー ACE800013(平中泰斗・元から本番に存在)に pin_hash=bcrypt("123456")・kyc_verified_at・postal_code/address ダミー・identities の写真パスダミーを書き込んだ。KYC 付与により本番ドライバー一覧に表示されユーザーが発見
- **復旧**: identities の写真パス2件を null に復旧(私)。drivers 行はユーザーが管理画面から削除済みのため残作業なし。identity 行(6fda8052)は残存 — 由来調査・削除はユーザー判断待ち
- **未回復の可能性**: 上書きした postal_code/address の元値(存在したかも不明)。必要なら Supabase のバックアップ/PITR で確認可
- **書き込みはこの4項目のみ**(打刻・日報等の作成は無し)。閲覧はドライバー一覧・当該者の登録状態
- **再発防止**: メモリに環境警告を記録。dev Supabase 新設までローカル/シミュレータからの書き込みテスト禁止。DB の同一性は URL 突合で検証してから書き込む
- ローカル web(:3001)と Metro(:8081)は再開済み

## 2026-08-01 00:20 ACE800013 の完全復元(Pro 日次バックアップから)

- Supabase Pro の Scheduled backups → Restore to a new project(課金は時間割で実質数円)でユーザーが 7/30 時点の drivers 行を抽出 → 私が本番へ元値のまま INSERT(id/created_at/pin_hash/住所/名簿順まで完全一致)
- **判明**: 平中泰斗さんは 7/30 21:05 JST 作成の実在の新規登録者(写真未提出で本登録途中・KYC未承認)。dev データではなかった
- identities の写真パスは元々未設定(7/31調査ログと一致)で現状も null = 元の状態
- 残確認: 複製プロジェクトで driver_identities の有無を確認後、複製プロジェクト削除(ユーザー)

## 2026-08-01 00:45 dev-nippo 再建完了・ローカル開発の安全化

- dev-nippo(ref wdbifbzw…)が pause から復帰 → 本番と別プロジェクトであることを ref 突合で検証 → migrations 104〜119 を適用(103 で停止していた。`_migrations` 台帳で差分適用)
- apply-migrations.ts を `.env.development.local` 最優先に変更(本番誤爆の構造的防止)。ローカル :3001 も同ファイルで dev-nippo 接続に
- 既存 dev データ(AAA org・5名)を再利用: AAA111111 田中太郎を PIN 123456・ゲート通過済みに整備、AAA org にコース3本+今日のシフト作成。ローカルAPIでログイン→シフト表示まで検証
- 注意: .env.development.local に無いキーは .env.local(本番)にフォールバック。dev から電話OTPは実SMSが飛ぶため PIN ログインを使う
- 平中さん(ACE800013)の件は復元完了済み。residual: driver_identities の有無確認(ユーザーが複製プロジェクトで確認後、複製削除)
- 決定事項: platform コンソール Phase1 は集計のみ・PII なし/platform_admin は平石孝也 identity に付与/上流管理画面→dev検証→本番テストorg の順

## 2026-08-01 01:05 platform コンソール Phase 1 実装(dev 検証済み)

- migration 120: platform_admins(identity基準)/org_applications(KYB申請台帳)/platform_audit_logs
- サーバ基盤 src/server/platform: requirePlatformAdmin(identityId→platform_admins判定)・logPlatformAction・bootstrapOrganization(organizations+system ロール4種は DEFAULT_ROLE_CAPABILITIES 正本+初代ADMIN招待14日)
- API: GET /api/platform/orgs(org別集計: active/KYC済ドライバー・日報/稼働/通知/LINE通数の当月件数・最終日報。**PIIエンドポイントは作らない設計**)、/api/platform/applications(一覧+PATCH: reviewing/reject/approve→ブートストラップ)、POST /api/apply(公開申請・ハニーポット)
- UI: /platform(ダークヘッダーPLATFORMブランド・org集計テーブル・審査待ちバナー)、/platform/applications(審査+承認モーダル→参加コード・招待リンクを一度だけ表示)、/apply(公開申請フォーム)
- dev-nippo 検証: migration適用→平石孝也identityにplatform_admin付与→申請→承認→TESTUN org発行(ロール束 ADMIN20/ACCOUNTING11/VIEWER7/DRIVER0)・監査ログ記録・非運営者403 まで一巡確認。web tsc/テスト421 green
- 残: 本番適用(migration 120+platform_admin付与)→本番テストorg作成、監査ログ閲覧UI、API呼出回数の計測(Phase 2)、break-glass(Phase 2)

## 2026-08-01 01:15 本番反映の準備(platform コンソール)

- 本番の平石孝也 identity を電話番号(+81形式)で特定: 4e361048-4bb7-43d3-9513-a47373d5995e
- 判明: .env.local の SUPABASE_DB_URL は dev-nippo の旧パスワード付き接続文字列(本番の DB 直結情報はどこにも無い)→ 本番 migration 適用にはユーザーが .env.production.local へ本番接続文字列を追記する必要あり
- platform コンソール(7656640)+worklog(abd4c1c)をコミット済み。push は権限ブロックのためユーザー操作待ち
- 残: ①ユーザー push(→Vercel本番デプロイ) ②本番 SUPABASE_DB_URL 追記 → migration 120 適用+platform_admin 付与(私) ③hakotora.jp/platform からテスト org 発行

## 2026-08-01 01:25 本番反映: migration 120 適用+platform_admin 付与 完了

- ユーザーが .env.production.local に本番 SUPABASE_DB_URL を追記 → ref(postgres.ooirajii…)で本番であることを検証してから migration 120 を psql 適用(platform_admins/org_applications/platform_audit_logs の3テーブル。本番に _migrations 台帳は無く手動適用の流儀どおり)
- platform_admins に平石孝也 identity(4e361048…)を付与(本番1件)
- 残: **git push origin main が未実施(ahead 2)** — push されると Vercel が /platform・/apply を本番デプロイ。その後 hakotora.jp/platform からテスト org 発行

## 2026-08-01 01:35 平中さん復元クローズ・本番デプロイ完了

- 複製プロジェクトで driver_identities(ACE800013)が空であることを確認 → 復元対象は drivers 行のみで完了済み。**復旧クローズ**(複製プロジェクトは削除可)
- ユーザーが push → Vercel 本番デプロイ確認(/apply 200)。hakotora.jp/platform 利用可能に
- Vercel プロジェクト名の hakotora へのリネームは安全と回答(カスタムドメイン・env・ID 不変。*.vercel.app サブドメインのみ変わる)

## 2026-08-01 01:45 platform コンソール拡大方針を設計正本に記録

- hakotora.jp/platform の本番動作をユーザー確認
- platform-design.md に §2-5a 新設: Phase 1 実装内容+**Phase 2 以降の拡大方針10項目**(監査ログ閲覧UI/break-glass/API実測/DB層PII遮断/orgライフサイクル/LINE上限UI/課金/KYB支援/認証方式選択/時系列メトリクス)
- roadmap-2026-07.md にトラック L 追加(残: 本番テストorg発行・Phase 2)

## 2026-08-01 02:05 hakotora-dev.vercel.app 復活(dev-nippo 接続)・dev/本番の運用形を確立

- hakotora-dev(Vercel)の SUPABASE_URL/SERVICE_ROLE_KEY/DB_URL を dev-nippo に差し替え(Production+Preview)。
  初回は ①.env.development.local の行内コメント混入 ②npx 経由 stdin で空文字保存 の二重障害でビルド失敗
  → Vercel API 直叩きで正しい値に置換 → ユーザーが再デプロイ → **AAA111111 でログイン検証 OK**
- これで実機からローカルサーバ無しで dev API(hakotora-dev.vercel.app → dev-nippo)を叩ける経路が復活
- 運用形の合意(「長生き dev ブランチは作らない」): main 一本+短命ブランチ/本番(nippo-ace)=main 自動デプロイ/
  hakotora-dev=手動デプロイ(任意タイミングで main を上げる)/危険な変更のみ短命ブランチから vercel deploy の
  プレビュー URL(Preview env=dev DB 設定済み)で確認して即マージ
- platform-design.md §2-5a・roadmap トラック L の拡大方針記録も本ターンで完了済み

## 2026-08-02 mobile P1: ヒーローカードのバン+箱アニメ・Spotify型業務中モード(ミニバー)

- **バン画像アセット**: 地図と同じ truck.glb(Kenney delivery van)を model-viewer でローカルレンダし、パレットテクスチャの緑をブランドアンバー(hue 43°、彩度・明度は元の陰影を維持)にピクセル置換して透過PNG化(左後方3/4視点・トリム済み 1080x710)→ `apps/mobile/assets/van-amber.png`。レンダは Chrome 自動化(model-viewer は非表示タブだと lazy load でスタックするため loading=eager 必須、と CDP スクショ不調時は toDataURL→ローカルPOSTサーバ保存が確実、という2つの学びあり)
- **HeroVan コンポーネント**: ヒーローカード(挨拶+名前の直下)に事前レンダのバン+地面影+段ボール箱3個の reanimated ループアニメ(左→リアシャッターへ3ホップで流れ込み、ハッチ手前でフェード=積み込み完了に見せる。transform/opacity のみ・cancelAnimation でクリーンアップ)
- **WorkSessionContext 新設**: 稼働セッション(open/todaySessions/loading/loadError)+車両一覧を WorkScreen ローカルから Context に昇格。WorkScreen は操作フロー状態のみ保持する形にリファクタ
- **WorkingMiniBar(Spotify型業務中モード)**: 稼働中にホーム以外のスタック画面(シフト・報酬・通知・マイページ)下部に浮かぶ brand-900 のバー(明滅アンバードット+経過時間+ナンバー+タップでホームへ)。App.tsx で navigationContainerRef から現在ルートを追跡して表示制御。formatTime/formatDuration は src/format.ts に共通化
- 検証: mobile tsc クリーン。シミュレータ/実機での見た目確認は未(dev client は HMR 不通のため再起動が必要)
- P1残: ③案A全画面カメラ(統一キャプチャフロー)。ユーザー製アセット(Blender バン glb / Illustrator 箱SVG)が来たら差し替え

## 2026-08-02 調査: 招待リンク経由の申請が承認待ちに出ない原因

- 事象: 招待リンク(らいらさん宛・7/31 使用)で申請が送信されたが org 管理画面の「承認待ち」に出ない
- DB痕跡(本番へ SELECT のみ): invites 行は used_at=7/31 06:47Z・used_by_identity 記録済み=招待消費まで到達。drivers 行の直接照会は権限クラシファイアにブロックされ未確認(Supabase ダッシュボードで identity_id='e4c37a62-8f54-4694-8f73-f2c7361a7245' を確認可)
- **根本原因(コード)**: POST /api/join の drivers insert が works_as_driver を設定していない(DB デフォルト false・migration 104、トリガー同期なし・アプリ同期方式)。一方 GET /api/admin/users?status=pending は .eq(works_as_driver,true) でフィルタ → **/join 経由の申請は構造的に全員 承認待ちに表示されない**。手動追加(POST /api/admin/users)は works_as_driver:true 明示のため見える
- 付随UX: 招待リンク無効時に OnboardingWizard が「参加コードを入力してください」ステップに落ちる(エラーは出るが導線が不自然)。招待経由は行き止まり画面(運営に再発行依頼)にすべき
- 修正方針(未実施): ①/api/join insert に works_as_driver:true(+system DRIVER の role_id)②既存 pending 行の works_as_driver=true への UPDATE(本番書き込みのため要ユーザー承認)③ウィザード無効時の行き止まり画面

## 2026-08-02 修正: /join 申請が承認待ちに出ない不具合(works_as_driver)+招待無効時のUX

- POST /api/join の drivers insert に works_as_driver:true を明示(手動追加パスと同一。role_id は手動追加も未設定のため揃えて据え置き)
- 本番データ修復: 該当 pending 行(925dad41)を works_as_driver=true に UPDATE(ユーザーが行を確認・承認のうえ実行)。status=pending かつ works_as_driver=false の他行は0件=影響はこの1件のみ
- 招待リンク無効時のメッセージを理由別に分割(オーナー判断: 「このリンクは使用済みです」「リンクの有効期限が切れています」を区別。不正トークン・失効・org停止は中立の「この招待リンクは無効です」のまま)。/api/join/lookup・/api/join(事前チェックと消費レース)の両方
- OnboardingWizard: 招待無効時に参加コード手入力へ落とすのをやめ、行き止まり画面(サーバ文言を見出し表示)に変更。新ステップ "invite-invalid"
- 検証: web tsc クリーン・テスト 421 passed。※デプロイ(main push→Vercel)は未実施

## 2026-08-02 参加・承認ページの再構成+ナビに承認待ちバッジ

- サイドナビ「ドライバー」→「参加・承認」に承認待ち件数バッジを追加。新API /api/admin/users/pending-count(can_view_members・works_as_driver=true & status=pending を count)。親「ドライバー」バッジは免許警告+承認待ちの合算に
- 参加・承認ページの主役を承認待ちリストに変更: ①承認待ちを最上部へ ②本人確認待ちは対象がいるときのみ表示(承認1回統合後はKYC未提出のまま承認したときだけ使うフォールバックのため) ③招待リンク発行・共有参加コードはヘッダー右上の小さいボタン→モーダルに退避
- 検証: web tsc クリーン・テスト 421 passed

## 2026-08-02 13:50 参加導線を個別招待リンク一本化+発行UXの改善

- **共有参加コードの UI 撤去**(ユーザー決定「個別リンク1本でいく」): 参加・承認ページから共有コード表示・再生成・QR・共有リンクコピーを削除。NEXT_PUBLIC_INVITE_LINKS_ENABLED フラグも撤去(招待リンクUIは常時表示)。/join?code= と /api/admin/join-code は既存導線互換のため残置
- **招待履歴の絞り込み**: 一覧は 有効+期限切れ のみ表示(使用済み・失効は非表示。DB には永続、成果は承認待ちリストに現れる)
- **コピーButtonの改善**: アイコンのみ(32px正方形・title/aria付き)。コピー済みは緑チェック+軽いスケールで遷移を明示(transition-all 300ms)
- **発行の体感速度**: ①POST の返り値で SWR キャッシュを直接更新(revalidate なし)=「発行中…」明け即座に一覧へ出現 ②認可レイヤ resolveAuthz 新設 — capability 解決の drivers 参照に org_id を同乗させ requirePermission が user.orgId(DB正本)を返すように。invites GET/POST・pending-count で resolveOrgId の1往復を削減(他ルートも user.orgId ?? resolveOrgId パターンで順次採用可)
- **承認待ちリストに顔写真アバター**(ユーザー要望「対面済みなので顔で直感できるように」): API 既存の faceUrl(署名URL)を 44px 丸アバターで表示。未提出は頭文字のプレースホルダ
- 失効ボタンは存置(誤送信したリンクを7日の期限前に無効化する唯一の手段のため)
- 検証: web tsc クリーン・テスト 421 passed

## 2026-08-02 13:55 承認待ちアバターを拡大

- 顔写真アバターを 44px→56px(w-14)に拡大(ユーザー要望「1.3倍ぐらい」)。プレースホルダの頭文字も text-base に

## 2026-08-02 15:05 KYC詳細表示の刷新(ラベル左上・左揃え・和暦日付)

- 本人確認/承認モーダルの申告内容を KycDetailView に共通化(重複2箇所を統合)。ラベルは小さく中身の左上・中身は左揃えの2カラムグリッドに変更。郵便番号は小さく副次表示
- 生年月日・免許有効期限は「YYYY年M月D日」表記に(人が読む日付にハイフンを出さない UI 規約として formatDateJP を page 内に定義)
- 検証: web tsc クリーン・テスト 421 passed

## 2026-08-02 15:15 KYC詳細のバランス調整+電話番号フル表示

- 免許証・顔写真のサムネを同一サイズ(4:3・object-cover)に統一(縦横比の違いで崩れていたバランスを解消。全体表示より確認しやすさ優先)
- 申告内容グリッドを2×2に: 氏名(漢字)・フリガナ / 生年月日・免許有効期限 / 電話番号・口座 / 住所(全幅)
- /api/admin/users/[id]/kyc に phone(フル)を追加 — can_view_pii ゲート下で住所・免許・顔まで開示済みのため電話だけマスクする意味がない(ユーザー判断)。一覧(status=pending・can_view_members)の下4桁マスクは別ゲートとして維持
- 同ルートの認可を hasCapabilityCached / user.orgId 化(getCapabilities 再照会と resolveOrgId の計2往復削減。hasCapabilityCached を @/server/auth から export)
- 確認: KYC 画像(免許・顔)は削除処理が存在せず保持し続ける仕様。顔写真は名簿・承認待ちのアバターとして再利用中
- 検証: web tsc クリーン・テスト 421 passed

## 2026-08-02 15:22 KYC詳細: 日付単位を小さく・電話を国内表記に

- 日付表示を DateJP コンポーネント化(「年」「月」「日」を 11px・薄グレーにして数字を主役に)
- 電話番号を formatPhoneJP で国内表記に(+81→0 始まり。0X0 の11桁携帯は 3-4-4 区切り)。DB は E.164 のまま・表示層のみ
- 検証: web tsc クリーン

## 2026-08-02 15:40 KYC詳細の微調整(ヘッダー重複削除・日付間隔・住所改行)

- モーダルヘッダーの氏名・マスク電話の小書きを削除(詳細グリッドと重複。承認モーダルはKYC未提出時のみ氏名を補足表示)
- DateJP: 年・月の単位後ろに mr-1.5 を入れ「1999年 3月 30日」のかたまりを分離
- 住所: 郵便番号を独立行に。住所本文は空白区切り(番地と建物名の間に空白がある提出)ならそこで改行、なければCJK自然折返し
- 検証: web tsc クリーン

## 2026-08-02 15:50 /join ウィザードに「建物名・部屋番号(任意)」欄を追加

- 住所ステップに別欄を追加し、保存時に「住所␣建物名」へ空白結合(DB は単一カラムのまま・スキーマ変更なし)。KYC詳細の表示側は既存の空白改行がそのまま効く
- サーバから戻る合成済み住所は最初の空白で分割して各欄へ復元(splitAddress。再開・OTP後・face後の3経路とも)
- autoComplete=address-line2 でブラウザ補完にも対応
- 検証: web tsc クリーン・テスト 421 passed

## 2026-08-02 15:55 住所の空白正規化(区切り曖昧性の解消)

- ユーザー指摘「住所入力中のスペースと建物名区切りを区別できない」への対応: 保存時に住所欄内の空白を全除去(日本の住所表記に空白不要)。保存値に現れる空白=建物名との区切り、が一意に。スキーマ変更は見送り(現状の住所用途は表示のみ。帳票・構造化が必要になったら address_building カラム分離を検討)
- 検証: web tsc クリーン

## 2026-08-02 16:00 日報: 半年/1年指定で未提出が消えるバグ修正(PostgRESTの1000行上限)

- 事象: 期間を半年にすると一部ドライバーの「日報が未提出です」が「休み」表示になり要対応から消える(今月では正しく出る)
- 原因: /api/admin/daily/day-summary-range の shifts 範囲クエリが PostgREST 既定上限(db-max-rows=1000)で黙って切り詰められ、後半日付のシフトが欠落 → シフトなし=休み扱いに。半年分は 29人×184日+複数スロットで軽く超過。日報側(loadLegacyDailyRows 等)は fetchAllRows でページング済みで、この shifts クエリだけ未対応だった
- 修正: fetchAllRows(range ページング+shift_date,id の安定ソート)で全件取得に変更
- メモ: shifts クエリに org 絞り込みが無い件は shifts テーブルに org_id 列が無い単一テナント遺産のため今回は据え置き(テナント分離=own化の課題に包含)。/api/admin/shifts(月窓)にも同じ 1000 行上限の潜在リスクあり(コース数次第)→未対応
- 検証: web tsc クリーン・テスト 421 passed

## 2026-08-02 17:25 日報: 要対応は期間無制限・閲覧は1ヶ月単位に再設計

- ユーザー決定「承認済みの振り返りは1ヶ月で十分。未承認・未提出は期間で切らずすべて出すべき」
- day-summary-range に pending=1 モード追加: 期間パラメータ無しで全履歴から「要対応(未提出・未承認)が残る日+今日」だけを返す。判定はシフト×提出コース×承認状態の素集計で先に日付を確定し、レポート行と report_entries の取得もその日付に絞ってペイロード肥大を回避
- 日報ページ: 未承認タブから期間ピッカーを撤去(常に pending=1)。すべてタブのプリセットは 先月/今月/カスタム のみ(半年・1年撤去)
- DateRangePicker: hideSixMonths を presets プロパティ(表示プリセット指定)に置換。sales ページは従来相当(先月/今月/1年/カスタム)を明示
- unread-count(ナビのバッジ): ①shifts クエリの1000行上限を fetchAllRows でページング(90日窓×29人で既に超過し過少カウントだった) ②既定の遡りを90日→全履歴に変更し pending=1 と定義を統一
- 検証: web tsc クリーン・テスト 421 passed

## 2026-08-03 00:35 KYC承認支援(ハコ虎AI 第2弾): 免許証のAI照合

- 承認/本人確認モーダルの詳細下に「AIで照合する」ボタンを追加。免許証写真を Claude vision + structured outputs で読み取り(氏名・生年月日・有効期限・住所。和暦→西暦変換)、申告内容との一致/不一致をバッジ表示(一致/概ね一致/不一致/未確認)。免許証でない画像の検知・読み取り注意(warnings)も表示。判定は参考情報で最終確認は目視、の注記付き
- server/ai/kycVerify.ts 新設(抽出=AI・突合=決定的処理の分担は shiftImport と同型。住所は正規化+「番地まで一致」を許容し建物名の有無を吸収)。API は POST /api/admin/users/[id]/kyc-check(can_view_pii・Storage から直接ダウンロード・結果は保存しない都度実行)
- モデルは HAKOTORA_AI_MODEL(既定 claude-sonnet-5)。Vercel の ANTHROPIC_API_KEY 設定済みをユーザー確認済み
- 検証: web tsc クリーン・テスト 421 passed。実写真での挙動確認は本番デプロイ後

## 2026-08-03 01:00 地図: 配車作戦盤の方針確定+共有ビュー(Stage 1)実装

- roadmap トラック K を「地図→配車作戦盤」に改題し段階案を記録: Stage 0 実データ化 / 1 共有ビュー / 2 what-ifシミュレーション / 3 AI合流(音声→制約構造化・AI配車提案の出力先)。ユーザー合意 2026-08-03
- **共有ビュー実装**: /admin/map に「共有」ボタン。参加者の在席(presence)・地図上カーソル(色付きドット+名前)・視点追従(参加者チップをタップでフォロー、自分でドラッグすると解除)を Supabase Realtime broadcast で同期
- 構成: クライアントは Realtime のみ使用(DB 不触)。入場券 API /api/admin/map/share-session(can_view_vehicles)が SUPABASE_URL/anonキー/HMAC導出チャンネル名を認証済みユーザーにだけ手渡す(anon キーは NEXT_PUBLIC に置かない)。フック @/lib/map/sharedView.ts(camera 150ms/cursor 120ms スロットル、フォロー適用中の move を自送信から除外)
- **要設定**: SUPABASE_ANON_KEY を Vercel と .env.local に追加(未設定時は共有ボタンがエラーメッセージを出す)。Supabase ダッシュボード > Settings > API の anon public キー
- 検証: web tsc クリーン・テスト 421 passed。複数ブラウザでの実動確認は anon キー設定後

## 2026-08-03 01:20 シフト表に同時編集カーソル(誰がどのセルを触っているか)

- シフト管理のコース×日付・ドライバー×日付の両グリッドで、他の運営がマウスを置いているセルの右上に色付き名前バッジを表示。グリッド外に出ると消える(table onMouseLeave で null 送信)
- 汎用フック @/lib/realtime/cellCursors.ts 新設: presence+broadcast(event=cell、同一セル再送なし)。ページ表示中は自動接続のアンビエント表示で、SUPABASE_ANON_KEY 未設定・権限なし・接続失敗時は黙って無効(編集機能に影響しない)
- 入場券 API を scope 対応に拡張(/api/admin/map/share-session?scope=shifts、can_view_shifts でゲート。チャンネルは org×scope の HMAC 導出)
- 検証: web tsc クリーン・テスト 421 passed。複数ブラウザでの実動確認は SUPABASE_ANON_KEY 設定後(地図の共有ビューと同じ前提)

## 2026-08-03 01:25 配車変更ログ(shift_change_logs)— AI導入時の学習データ布石

- ユーザー提案「誰が・いつ・どの配車をどう変えたかを軽く残すと AI 導入時に効く」
- migration 121: shift_change_logs(追記専用・org_id/actor/action/shift_date/course/slot/before/after jsonb)。**本番未適用=要適用**
- server/shiftLog.ts: logShiftChange(ベストエフォート・失敗しても本処理は成功。呼び出しは void で投げっぱなし)
- 配線: ①POST /api/admin/shifts(assign_driver/clear_driver。変更前を1読取し差分がある時だけ記録)②/shifts/vehicle(assign_vehicle・同様)③/shifts/vehicle-loans(loan_on/loan_off)
- 「誰がどの車を使ったか」は vehicle_sessions(出退勤)が一次ログのため対象外と整理。シフトAI取り込み(import/apply)のログ化は未対応(要るなら1サマリ行を追加)
- 検証: web tsc クリーン・テスト 421 passed

## 2026-08-03 01:40 【重要】ページングの ORDER BY 欠落で日報・集計の行が欠落していた

- 事象: 未承認タブで 7/1〜7/3 等の過去日に「日報が未提出です」が大量表示。DB を直接照合すると当該日のシフト10件すべてに承認済み日報が存在＝**表示が誤り**
- 真因: `fetchAllRows` は `.range()` でページングするが、**呼び出し側クエリに ORDER BY が無い**ものが多数あった。Postgres は ORDER BY 無しの OFFSET/LIMIT で行順を保証せず（synchronize_seqscans もあり）、**ページ間で行の重複・欠落**が起きる。本番で実証: 順序なしで5回試行 → 1回が「2114行取得・ユニーク2113」(重複1・欠落1)。順序ありは3回とも完全一致
- なぜ今出たか: 日報 v2 は 2114 行あり、従来の90日窓(1000行未満)では1ページで収まり露見しなかった。要対応を全履歴化した 2026-08-02 の変更でページングが常時発生するようになった
- 修正: ページングする全クエリに一意な ORDER BY を追加 — legacyShape(日報本体・report_entries)/ load.ts(日報・ledger_entries・report_entries)/ reportContent / reports-summary(2箇所)/ **billing/vehicleRecovery(車両費按分＝金額に直結)**。pagination.ts の docstring にも要件を明記
- 検証: 本番データで修正後ロジックを再計算 → 7/1〜7/3 の要対応は 0 件、全履歴で残る要対応は 2026-08-02(当日)のみ。web tsc クリーン・テスト 421 passed
- 注記: 車両費按分(vehicleRecovery)は 1000 行超の期間で金額がブレていた可能性あり。過去の請求額の再確認が必要かはユーザー判断

## 2026-08-03 03:20 参加・承認の細部改善(フリガナ表記・先読み・スケルトン・画像拡大)

- 一覧の副題を「マスク電話 ・ 申請日」→「フリガナ ・ 申請日」に(同姓の識別にはフリガナの方が有用というユーザー判断)。承認待ち・本人確認待ちの両リスト。API 側は /api/admin/users の pending 行と stage=kyc 行に nameKana を追加(identities.name_kana)。stage=kyc のマスク電話は不要になったため撤去
- **KYC 詳細の先読み**: 一覧が出た時点で can_view_pii があれば対象ドライバーの詳細を裏で直列プリフェッチ(kycCacheRef)。モーダルは待ち時間なしで開く。署名URLは10分失効のため開くたびに裏で取り直す stale-while-revalidate 方式
- 読み込み中の「読み込み中...」テキストを KycDetailSkeleton(写真2枠+2×2グリッド+住所)に置換
- 免許証・顔写真をクリックで全画面拡大(cursor-zoom-in、背景クリック/Escで閉じる)。細かい記載の確認用
- 検証: web tsc クリーン・テスト 421 passed

## 2026-08-03 13:00 スケルトンを実表示に忠実化(モバイル/PC 分岐つき)+区切り記号

- 一覧副題の区切りを「・」→ 全角スペースに(氏名フリガナ␣申請日)。承認待ち・本人確認待ちの両リスト
- **参加・承認**: 承認待ちのスケルトンを実行と同骨格に(56px 丸アバター/氏名/フリガナ+申請日/状態バッジ/承認・却下ボタン。canWrite でボタン有無も一致)
- **日報**: 読み込み中が常にテーブル骨格だったのを、実表示と同じく **スマホ=カード / PC=テーブル**に出し分け。PC 側の列構成も実表(名前/種別/車両/メーター/内容/承認/操作/送信時刻・canWrite 連動)に一致させ、日付見出しのプレースホルダも追加
- **車両管理**: 上部1行(No./車種/ドライバーチップ/次回車検・自賠責/操作アイコン)が欠けていたので追加。左側はプレート+車両画像で**スマホ横並び・PC 縦積み**の実分岐を再現、右側はゲージ2本(バー+上下ラベル)の形に
- **ドライバー名簿**: 一律の棒線8本から、スマホ=丸アバター付きカード / PC=名簿テーブル(No./ドライバー/表示名/コース/免許期限/権限)に
- 残: payments・sales・shifts 等の他画面は未着手(同じ方針で順次)
- 検証: web tsc クリーン・テスト 421 passed

## 2026-08-03 13:35 スケルトン残り3画面 + 設定権限の領域別分割

### スケルトン(モバイル分岐つき)
- シフト: スマホ=日別リスト(氏名+チップ) / PC=月グリッド に出し分け。セルも実寸(3.25rem)に
- ペイメント: スマホ=開閉カード(氏名・報酬/控除・支給額・操作2ボタン) / PC=8列テーブル
- 売上: 日別マトリクスは スマホ=ドライバー別合計リスト / PC=表。ログ一覧も 日付見出し+スマホカード/PC行 に
- これで payments・sales・shifts・daily・vehicles・users・pending の7画面が実表示準拠

### 設定の権限を領域別に分割(ユーザー要望「コースの設定だけさせたい人がいる」)
- capability 追加: can_manage_courses / can_manage_carriers / can_manage_report_kinds / can_manage_submit_screen
- **含意(CAPABILITY_IMPLIES)を新設**: can_manage_org_settings → 上記4つ + can_view_org_settings。領域別 → can_view_org_settings。
  resolveAuthz が解決時に展開するので**既存ロールの role_capabilities 行を移行せずに互換維持**(本番 ADMIN は設定編集ありを確認済み)
- クライアント側 lib/capabilities.ts でも同じ含意を展開(既ログインのセッションでも再ログイン不要でUIが正しく出る)
- ゲート差し替え: courses/units→can_manage_courses、carriers/unit-fields→can_manage_carriers、report-kinds、submit-screen。events・map places・sales log types は従来どおり包括(can_manage_org_settings)
- 権限設定UIには領域別4行が「編集可能」トグルとして自動で並ぶ(PERMISSION_ROWS 追加)。role_capabilities は text 列で CHECK 無し=マイグレーション不要
- 方針: 設定画面の**閲覧**は従来どおり can_view_org_settings で一括、**編集**だけ領域別に絞る(コース担当は他設定を見られるが変更できない)
- 検証: web tsc クリーン・テスト 421 passed

## 2026-08-03 14:00 コース選択UIの刷新 + コース側からの担当ドライバー割当

- **CoursePicker 新設**(lib/components/CoursePicker.tsx): ①キャリア別に見出しグループ化(件数の多い順・「その他」は末尾) ②各チップにコース色ドット ③9件以上なら絞り込み入力 ④選択済みはチェック＋濃色。27コースが一列に並んで読めない問題への対処(ユーザー相談 2026-08-03)
- 適用: 参加承認モーダルのコース選択 / ドライバー編集の担当可能コース(区分1・区分2)。選択済みチップの常時表示(色つき)は従来どおり残し、アコーディオンの中身をピッカーに差し替え
- /api/admin/courses GET が carrier_name を返すように(carriers 埋め込み)。グループ見出しに使用
- **コース一覧から担当ドライバーを選べるように**: 各コース行に「担当を選ぶ」→ モーダル(名前絞り込み+チップ選択)。API `PUT /api/admin/courses/[id]/drivers`(GET も用意)を新設。can_manage_courses または can_manage_members で許可
  - 実体はドライバー編集と同じ driver_courses。既存行は勤務区分(slot)を保つため据え置き、外れた人の行だけ削除・新規は区分1に紐づけ。org 越えの読み書きはアプリ層で遮断
- 検証: web tsc クリーン・テスト 421 passed

## 2026-08-03 14:30 roadmap の実態同期（LINE 完了扱い・mobile 更新）＋コース×地図の要望を記録

- **誤読の訂正**: 棚卸しで「LINE はチャネル開設から」と誤って報告した。原因は roadmap トラック D の
  「通知（M3 丸ごと未着手）」という古い記述（2026-07-21 のトラック E 実装より前のもの）。実態を確認し、
  本番 env 設定済み・`line_link_codes`/`line_chat_messages`/`org_notification_settings` 適用済み・
  連携済み identity 2件 → E① と E⑥ を完了に、D の通知行を「サーバー/web 完了」に書き換え
- **E の残りを分離して記録**（ユーザー指摘「公式LINEの画面と通知の雛形は別タスク」）:
  リッチメニュー等の公式アカウント画面 / 通知テンプレート（何をいつ送るか・既定OFF方針は維持）/
  青バッジ申請（登記後の事務）
- **mobile トラックを実態に更新**: A は bundleId・SDK57 を完了扱いにし、残を eas init・Android ビルド・
  実機確認等に整理。B は P1 実装済み分（3状態ホーム・タブレス・バン+箱アニメ・稼働中ミニバー）を反映し、
  残を「案A 全画面キャプチャ」「終了フロー拡張」等に絞った
- **A4 を更新＋A4-b を新設**（ユーザー要望 2026-08-03「コースと地図をもっと紐づけたい」）:
  ①コースに集合場所（`courses.meeting_place_id → map_places`、地図から選択＋ナビ導線）
  ②配達エリアのポリゴン選択（`courses.area geojson`、作戦盤の重ね表示・圏判定・AI配車の入力）
  地図βで map_places と Mapbox が動いているため「共有リンク方式で始める」前提は不要、と前提も更新
- 検証: ドキュメントのみの変更（コード変更なし）

## 2026-08-03 15:10 mobile P1 完了: 案A 統一フルスクリーンキャプチャ

- **CaptureFlow.tsx 新設**: QR →（安全確認 or 抜き打ち免許撮影）→ メーター → 車両点検(4方向) を
  **1つの全画面カメラで一筆書き**に通すコンポーネント。従来は撮影UIが4種バラバラ
  (円形カメラ/MeterScanner/VehicleInspectionCapture/LicenseSpotCheck)で作法が毎回変わっていた
  - カメラは1枚だけ張りっぱなし（ステップ間で再マウントしない＝流れが途切れない）。
    非カメラのステップ(安全確認)はカメラ上に暗幕を重ねて同じ画面内で処理
  - 上部=文脈+進捗バー(ステップ名つき)+案内、中央=ステップ別ガイド枠、下部=シャッター/次へ/スキップ/やめる、で全ステップ共通
  - メーターと点検は「あとで入力」「スキップ」可（業務を止めない）。QR は退避ルート(QRが読めない)を継承
  - 抜き打ち免許確認(15%)の判定は開始時に1回引き、steps に反映（フロー中に分岐しない）
- **PunchButton をトリガー専任に**: 円の中にカメラを出す実装を撤去し、長押し充填→`onTriggered` でフローを開くだけに。
  「円はトリガー＋状態アンカーに徹する」という設計判断どおりの形に
- **WorkScreen 配線**: `startCapture(in|out)` でステップ列を組み立て → 完了時にメーター値/写真/点検を反映し確認シートへ。
  点検写真のアップロードは待たせず裏で実行。安全確認の BottomSheet は撤去（フロー内へ移動）。
  各シートに「撮り直す（メーター・点検）」を追加（撮影UIが1つになったため再実行で代替）
- 旧撮影コンポーネント3件（MeterScanner / VehicleInspectionCapture / LicenseSpotCheck）を削除
- 検証: mobile tsc クリーン / web tsc クリーン・テスト 421 passed。**実機・シミュレータでの動作確認は未**
- 残（roadmap D-B）: 終了フロー拡張（給油・返却・忘れ物）＋終了サマリー、BottomSheet の作り込み、デザインシステム整備

## 2026-08-05 17:40 認証・名簿まわりの修正だけを main へ cherry-pick

- 対象（`feat/mobile-capture-flow` から web のみ5コミットを cherry-pick -x）:
  - 承認時の名簿番号採番＋一覧の行番号フォールバック撤去
  - 名簿番号の自動採番拡張＋山本さんの手当てSQL
  - ログイン失敗理由の区別（承認待ち/却下/複数所属）とPINレスの案内
  - 電話番号の表記ゆれ吸収・管理画面作成のE.164正規化・Passkey登録失敗の文言
  - ドライバー削除時の孤児 identity 後始末＋クリーンアップSQL
- **モバイルと dev 限定UI（FleetMapBoard / OpsDashboard / /api/admin/dashboard/ops）は混入なし**を
  `git diff --name-only` で確認。変更は apps/web の10ファイル＋scripts の SQL 3本のみ
- 作業ログの衝突は main 側を採用して解消（追記の重複を避けるため。経緯はブランチ側に残っている）
- 検証: web tsc クリーン（`.next/types` の古い残骸によるエラーは再ビルドで解消）・
  テスト 421 passed・next build 成功

## 2026-08-05 17:45 ログイン画面に電話番号ログインの導線を追加

- 指摘「/login/recover に案内するボタンが必要では」への対応。従来は画面下部の
  薄いグレーのテキストリンク1本だけで、**PINレスの人にとっての唯一の入口**としては弱かった
- 2箇所に導線を置いた:
  1. **エラー直下の CTA**: PIN ログインが「このアカウントはPINを使いません…」で失敗したときだけ、
     その場に「電話番号でログイン」のボタンを出す（文言だけでは行き止まりになるため）。
     判定はサーバーのメッセージ（"PINを使いません"）で行い、再送信時にリセットする
  2. **下部の導線をボタン化**: Passkey ボタンと同格の枠付きボタンに変更し、
     副題に「初めての方・機種変更・PIN / Passkey を忘れた方」を添える。
     Passkey ボタンが出ない環境では「または」の区切りをこちらに付ける
- アイコンは Font Awesome の `faCommentSms`（絵文字は使わない規約どおり）
- 検証: web tsc クリーン・テスト 421 passed・next build 成功

## 2026-08-06 02:20 管理画面の「保存が消える」「反映が遅れる」の原因を潰す

ユーザー指摘: ①画面を閉じたせいで保存できていないことがある ②コースを設定してもドライバー一覧は
しばらく「未設定」のまま。**他アプリと違うのは仕組みであって不注意ではない**ので、3つの構造的原因を特定した。

- **原因1: 自動保存が「取り消されて」いた**（users/page.tsx）
  1秒デバウンスの自動保存で、`useEffect` のクリーンアップが `clearTimeout` していた。
  コメントには「モーダルを閉じても打ち切らない」とあったが、閉じると form/editingDriver が変わり
  依存が更新される＝クリーンアップが走って**保留中の保存が消えていた**。
  → クリーンアップでの取り消しをやめ（デバウンスは次回実行の冒頭の clearTimeout で成立している）、
    `flushAutoSave()` を追加。ページ離脱・タブ非表示・unmount では**取り消さずに即実行**する。
    fetch は unmount で中断されないので、飛ばしてしまえば完了する
- **原因2: HTTPキャッシュが mutate を無効化していた**
  `/api/admin/users`（max-age=60, SWR=600）や `/api/admin/users/[id]`（30/300）に Cache-Control が付いている一方、
  これらの画面の SWR fetcher は `apiFetch` を直に使っており `cache: "no-store"` が付いていなかった。
  → 書き込み後に `mutate()` しても**ブラウザキャッシュが古い本文を返す**ため最大60秒（SWRで最大10分）古いまま。
    users / users・pending / roles / sales / misc-reports の計13箇所を `swrFetcher`（no-store）に統一
- **原因3: 画面をまたぐ無効化が無かった**
  コース画面で担当ドライバーを保存しても、無効化するのは自画面のキーだけ。
  ドライバー一覧は `dedupingInterval: 10分` だったため、戻っても再取得されず未設定のまま。
  → `invalidateApi(...prefixes)` を `lib/swr.ts` に追加（SWR のグローバル mutate をキー接頭辞でフィルタ。
    useSWRInfinite の "$inf$" 前置に対応するため includes 判定）。
    コース保存→users、ドライバー保存→courses を相互に無効化。users 一覧の dedupe は 10分→30秒
- 検証: web tsc クリーン・テスト 421 passed・next build 成功
- 残: 同じ構造の画面（車両・請求など）にも `invalidateApi` を広げるか要検討。
  オフライン時の再送キュー（送信中に回線が切れた場合）は未対応

## 2026-08-06 02:30 自動保存を共通フック化し、回帰テストで守る

- 依頼「自動保存まわりのテストは書けるか。全画面に適用したい」への対応
- `src/lib/useAutoSave.ts` を新設し、ドライバー編集に直書きしていたロジックを切り出した:
  - デバウンス（既定1秒）／`enabled` で条件付き／`skipFirst` で初期流し込みを無視
  - **クリーンアップで保留中の保存を取り消さない**。離脱（unmount / pagehide / タブ非表示）では
    取り消しではなく **flush（即実行）**。fetch は unmount で中断されないので投げれば完了する
  - 保存中に来た変更は捨てず、完了後にもう一度保存（最後の入力を必ず反映）
  - `resetKey`（編集対象ID）で、別レコードの読み込みを「変更」と誤認しない。
    切り替え時に保留中だった保存は**前のレコードの値で**実行してから基準をリセットする
    （実装上の肝: resetKey の effect を値の effect より**前に宣言**する。effect は宣言順に走るため、
     そこではまだ latest が前の値になっている。render 中に副作用を書くと setState during render になる）
- `src/lib/useAutoSave.test.tsx`（12ケース）: デバウンス集約／**unmount で flush**／pagehide で flush／
  flush()／enabled=false／同内容は保存しない／保存中の変更の追い保存／失敗時 status=error と再送／
  status 遷移／resetKey 2件
  - **回帰検出を実測で確認**: クリーンアップの clearTimeout を戻すと「unmount で flush」が落ち、
    元に戻すと通る。テストが実際にこの不具合を捕まえることを確認済み
- ドライバー管理画面を `useAutoSave` に載せ替え（`skipAutoSave` / `autoSaveTimer` / `autoSaveStatus` を撤去）。
  「閉じる」ボタンで flush してから閉じるようにし、1秒待たずに確定するようにした
- 検証: web tsc クリーン・テスト **433 passed**（+12）・next build 成功
- 残: 他画面（シフト・請求書・コース等）への適用。シフト画面は独自の楽観更新＋1.5秒再検証を持つため、
  置き換えは挙動を確認しながら1画面ずつ行う

## 2026-08-06 02:35 コース・車両にも自動保存を展開

- `useAutoSave` を コース編集 / 車両編集 に適用（ドライバー編集に続き3画面目・4画面目）
- **コース**: 保存本体を `persistCourseEdit` として閉じる操作から切り離し、
  `editForm` を監視して自動保存。フッターは「キャンセル / 保存」→ 状態表示＋「保存して閉じる」に変更。
  背景クリックも同じ `closeEditModal()` に統一した
  - 注意点として**単価（course-billing）は別コンポーネントの状態で自動保存の監視外**。
    そのため閉じる操作では flush だけでなく `persistCourseEdit()` を必ず実行する（単価の取りこぼし防止）
- **車両**: 編集中のみ自動保存（新規追加は「保存」で確定。キー入力ごとにレコードが作られては困る）。
  デバウンスは入力項目が多く payload も大きいため **1.5秒**。
  画像は data URL（数MB）だが、未変更なら payload から外す既存実装があるので毎回送り直さない。
  フッターは編集時のみ 状態表示＋「閉じる」（flush してから閉じる）。背景クリックも flush する
- **UXの変更点**: 自動保存にした2画面では「キャンセル（変更を破棄）」ができなくなる。
  ドライバー編集が既にそうであり、取りこぼし防止を優先した。破棄が要る画面が出たら個別に検討する
- 検証: web tsc クリーン・テスト 433 passed・next build 成功
- 残: シフト（独自の楽観更新＋1.5秒再検証あり）・請求書エディタ。1画面ずつ挙動を見ながら

## 2026-08-06 02:40 シフト画面: onBlur 保存の取りこぼしを潰す

- シフト画面の書き込み（割当・車両・時間）は**もともと即時保存**でデバウンスが無いため、
  ドライバー/コース/車両のような「閉じたら消える」問題は無かった。**唯一の穴が集合場所**:
  `defaultValue` + `onBlur` の非制御入力で、**パネルを閉じる＝アンマウントでは blur が発火せず**
  入力が保存されずに消えていた（React はアンマウント時に blur を出さない）
- `AutoSaveTextInput`（新規・`src/lib/components/`）に置き換え。入力を止めれば自動保存、
  blur すれば即確定、アンマウントでも flush して取りこぼさない。空入力は null＝コース標準に戻す
  - テスト6件（`AutoSaveTextInput.test.tsx`）。**★blur しないままアンマウント→保存される**を含む
- **保存中の離脱警告**を追加: `autoSaving > 0` の間だけ `beforeunload` を張る。
  この画面は保存ボタンが無い（即時保存）ぶん、送信中にタブを閉じられると気づけないため
- 検証: web tsc クリーン・テスト **439 passed**（+6）・next build 成功
- 残: 請求書エディタ。ただし**単価設定の考え方から再検討**の方針がユーザーから出たため、
  自動保存の機械的な適用より先に設計の議論（下記）を優先する

## 2026-08-06 02:50 配車作戦盤の設計（位置の時系列化・履歴・シミュレーション・動画）

- ユーザー要望「GPS 前の今からドラッグで現在地を示す／移動シミュレーションを動画で書き出す／
  何月何日の車の位置を見る」に対する設計を `docs/design/map-board.md` に起票（実装はまだ）
- **中心の判断: 位置を「1車両1つの現在値」ではなく「出どころ付きの時系列」で持つ**。
  この1点で3要望が同じモデルに乗る（現在地=最新行 / 履歴=as-of / ドラッグ=manual を追記 /
  GPS=source を増やすだけ）。**上書きではなく追記**にして経緯を資産として残す
- `vehicle_positions`（org/vehicle/at/lat/lng/source['punch','manual','gps']/recorded_by/note）を新設案。
  **manual は集計（請求・稼働・走行距離）に使わない**運用で実績の信頼性を守る
- **シミュレーションは実績と別テーブル**（`sim_scenarios` / `sim_moves`・相対分でキーフレーム）。
  「もしも」が実績に混ざると地図の信頼が根本から崩れるため
- 履歴は既定で**点を線で繋がない**（打刻・手動配置は離散の事実）。GPS で点が密になったら補間へ切替
- 動画は **案A: `map.getCanvas().captureStream()` + MediaRecorder（webm）を推奨**。追加インフラ不要で
  見たままが撮れる。短所は実時間かかる・タブを裏に回すとコマ落ち・mp4 は別変換。
  サーバーの決定的レンダリング（headless Chrome+ffmpeg）は必要になってから
- roadmap トラック K に Stage 0.5（位置の時系列化＋ドラッグ）/ 0.6（履歴スクラブ）/ 2b（動画）を追加。
  **0.5・0.6 は GPS を待たずに着手でき、GPS 導入時に作り直しが不要**
- 要判断（設計書 §6）: ①手動配置を実績テーブルに入れてよいか ②履歴の点を線で繋ぐか
  ③動画は webm 開始でよいか ④シミュの経路は直線補間で始めてよいか

## 2026-08-06 03:05 プラン/課金・元請け下請け連携の設計と、判断待ち一覧の整理

- `docs/design/plans-and-billing.md`（新規）: 他社提供に向けたプランと課金
  - **価格より先に「席の定義」を決めるべき**という整理。推奨は `status='active'` の membership 数
    （pending/inactive は数えない。実装済みの状態をそのまま使える）
  - **プランはコードの分岐ではなくデータ**（`plans` / `org_subscriptions` ＋ `*_override`）。
    エンタープライズは新プランを作らず override で表現する
  - **制限は「増やす操作」だけ**。支払い遅延でも打刻・日報は止めない（現場を止める損害の方が大きい）
  - 支払いはカード（Stripe）＋請求書払いの二択。運送業はカードを嫌う会社が多い
  - AI・LINE・SMS は原価がある → プランに月間枠を持たせる（LINE は migration 111 の土台を流用）
  - 移行: 現行本番 org は enterprise + 無制限。`org_subscriptions` が無い org はフェイルオープン
- `docs/design/prime-sub-reports.md`（新規）: platform-design §4 の具体化
  - **同じ配送を二度入力させない**のが価値の中心。作成者は下請け、元請けは読む
  - `course_shares`（コース単位・scope・期間）＋ `course_share_links`（アプリ非利用の元請け向け）
  - ドライバー氏名は既定で共有しない（第三者提供の論点）。段階はエクスポート→リンク→in-app
- `docs/design/decisions-pending.md`（新規）: **ユーザー判断待ちだけを集めた一覧**。
  地図4件・課金7件・元請け3件・請求2件＋作業待ち。各項目に推奨を明記し、
  「全部推奨で」と言えば進められる状態にした
- 検証: ドキュメントのみ（コード変更なし）

## 2026-08-06 03:00 地図 Stage 0.5 実装（位置の時系列化＋ドラッグ配置）

ユーザー承認「全部推奨で。地図 Stage 0.5 から」を受けて実装。

- **migration 122 `vehicle_positions`**（要適用）: org/vehicle/at/lat/lng/heading/accuracy/
  source('punch'|'manual'|'gps')/recorded_by/note。**上書きせず追記**。
  既存の `vehicle_sessions` の打刻GPS（出勤・退勤の座標）を `source='punch'` として**冪等に取り込む**
  INSERT も同梱（NOT EXISTS ガード付きなので再実行しても増えない）
- **GET /api/admin/map/vehicles を作り直し**: 位置の正本を vehicle_positions に変更。
  車両ごとに最新行＝現在地。**`?at=<ISO>` を付けると as-of（その時刻の位置）を返す**＝Stage 0.6 の土台。
  稼働中か（sessionStatus）は位置とは別の事実なので vehicle_sessions から取る。
  レスポンスは `source` / `placedBy` / `note` を追加しつつ、従来キー（kind・sessionStatus・driverName）も維持
  したので **FleetMapCard / FleetMapBoard は無改修で動く**
- **POST /api/admin/map/positions**（新規・`can_dispatch`）: 手動配置を1行追記。
  他社車両を動かせないよう owner_org_id を明示確認。誰が置いたかを recorded_by に必ず記録
- **打刻時の追記**: `server/vehicles/positions.ts` の `recordPunchPosition` を check-in / check-out から呼ぶ。
  **位置の記録に失敗しても打刻は成立させる**（現場を止めない）。GPS 拒否で座標が無ければ行を作らない
- **/admin/map のドラッグ配置**: `can_dispatch` のときだけマーカーを draggable に。
  dragend で保存 →失敗したら**元の位置へ戻す**。吹き出しに「◯月◯日◯時に手動で配置（誰が）」を表示。
  画面上部に案内バー（「打刻GPSは上書きしません」と明記）
- 検証: web tsc クリーン・テスト 439 passed・next build 成功
- **残（次の一手）**: ①migration 122 の適用（Supabase SQL エディタ）②適用後に dev で動作確認
  ③Stage 0.6 履歴スクラブ（API は `?at=` 対応済みなので、日付＋タイムラインの UI だけ）

### 補足（2026-08-06 03:05）: Stage 0.5 の適用手順

1. Supabase SQL エディタで `supabase/migrations/122_vehicle_positions.sql` を実行
   （既存打刻の取り込みまで含む。`NOT EXISTS` ガード付きで再実行しても増えない）
2. 適用前は地図の車両が `position: null`（位置なし）になる点に注意
3. 適用後、`/admin/map` で `can_dispatch` を持つアカウントからピンをドラッグして動作確認
4. 次は Stage 0.6（履歴スクラブ）。API は `?at=<ISO>` で as-of 対応済みなので UI のみ

## 2026-08-06 03:10 Stage 0.6（履歴スクラブ）＋ ピンが動かせない問題の解消

- **指摘「ピンの動かし方がわからない。ドラッグすると地図が動く」への対応**:
  常時 draggable にしていたため、ピンを掴んだつもりで地図がパンしていた（掴む領域が分かりにくい）。
  → **明示的な「位置を置く」モード**を追加した:
    - ボタンで ON/OFF。ON の間だけピンが draggable になり、**光るリング（drop-shadow）**が付く
    - ON の間は `map.dragPan.disable()`＝**地図の移動を止める**ので取り合いが起きない
      （ズームはスクロールで可能。終了すると元に戻る）
    - 案内バーが状況で切り替わる（配置モード中／履歴中／通常／権限なしは非表示）
- **Stage 0.6: 履歴スクラブ**:
  - ヘッダーに「ライブ / 履歴」切替。履歴を選ぶと日付ピッカー＋タイムライン（0:00〜23:45・15分刻み）
  - 選択時刻を JST で ISO 化して `/api/admin/map/vehicles?at=<ISO>` を叩く（API は Stage 0.5 で対応済み）
  - 履歴中は自動更新を止める（読んでいる最中に動かない）。`keepPreviousData` でスクラブ中の点滅も防ぐ
  - **点と点は繋がない**（decisions-pending A2 の決定どおり）。案内バーにもその旨を明記
  - 履歴中は配置モードに入れない（過去に置くことはできない）
- 検証: web tsc クリーン・テスト 439 passed・next build 成功。hakotora-dev へデプロイ済み
- 残: dev で実操作の確認（migration 122 適用済み）。次は Stage 2a（シミュレーション）か
  mobile P2（GPS 実データ化）

## 2026-08-06 03:40 「どの車も光らない」「位置を置く が意味不明」への対応

- **文言修正**（指摘のとおり日本語として不自然だった）:
  「位置を置く」→ **「車の位置を直す」**、ON 時は「位置の修正を終える」。
  案内も「GPS がまだ無い車の居場所は、手で教えられます」に書き換え
- **光らなかった原因**: 既定マーカー（Mapbox の SVG ピン）に `filter: drop-shadow` を足しただけで、
  地図上ではほとんど視認できず、掴める領域も小さいままだった。
  → 修正中は**専用のつまみ（44px の丸・一連指定番号入り・脈打つリング）**に差し替える方式へ変更。
  `touch-action: none` を付けて、指でつまむときに地図側へスクロールを取られないようにした
  （CSS は globals.css の `.map-drag-handle`）
- **もう一つの可能性への手当て**: 位置が1件も無ければマーカー自体が出ないので「光らない」ように見える。
  → **「位置が記録された車両がまだありません（打刻GPSも手動配置も0件）」**を明示する空状態を追加。
  マーカーが無いのか掴めないのかを画面で区別できるようにした
- 検証: web tsc クリーン・テスト 439 passed・next build 成功。hakotora-dev へデプロイ済み
- 残: dev で再確認。もし空状態のメッセージが出るなら、原因は権限でも UI でもなく
  **dev DB に GPS 付きの打刻が無い**ということなので、手動配置で1台置くところから試せる

## 2026-08-06 03:50 位置がまだ無い車両を「選んで地図クリック」で置けるようにした

- 「地図に出ている車両はシードデータ」というユーザーの指摘どおり、**位置が1件も無い状態**では
  掴むピンが存在せず、ドラッグ配置に入れない（鶏卵）。これを解消した
- **未配置車両の一覧（チップ）** を地図の上に出し、車両を選ぶ → **地図をクリックした場所に置く**。
  選択中は「地図をクリックすると ◯◯ をそこに置きます」とカーソル crosshair で状態を示す
- ドラッグ配置とクリック配置は `savePosition()` に共通化（保存・再取得・失敗時の巻き戻し）
- 空状態の文言も導線に合わせて更新（「上の一覧から車両を選び、地図をクリックすると置けます」）
- 検証: web tsc クリーン・テスト 439 passed・next build 成功。hakotora-dev へデプロイ済み
- 残: dev で実操作の確認。置いたあとは通常のドラッグ（「車の位置を直す」モード）でも動かせる

## 2026-08-07 02:20 デモ車両を撤去し、ナンバー吹き出し・3Dモデルを実データへ接続

- **デモ車両（`DEMO_VEHICLES` 10台のハードコード）を削除**。京都市内に散らした架空のナンバーと
  3Dモデルが本番でも出ていた。実データが入る導線（Stage 0.5）が揃ったので役目を終えた
- **ナンバー吹き出し（`VehicleLabel`）を実データに接続**: 位置が記録された車両（`located`）ごとに
  黒ナンバー風の吹き出しを出す。状態は稼働セッションから導出（open→稼働中 / closed→稼働外）。
  デモ用の4状態（積み込み中・休憩中）は実データに対応する情報が無いため2状態へ整理
- **3Dモデルも実データへ**: `truck-src` を空で作り、`located` から GeoJSON を流し込む方式に変更。
  地図/航空写真の切替でスタイルが再読込されるとソースが作り直されるため、
  `applyVehicleModelDataRef` 経由で**作成直後に最新データを再適用**する
- 吹き出しの重なり回避（declutter）はデータ更新後にも効くよう ref 化して呼び出す
- 検証: web tsc クリーン・テスト 439 passed・next build 成功
- roadmap トラック K の「プレート吹き出しを実データに接続」を完了に更新

## 2026-08-10 18:40 地図の見づらさを解消・状態導出・車種/車体色の受け皿

実機スクショ3枚のフィードバック「なんか見づらいなあ」への対応。

- **原因**: 1車両に対して ①3Dモデル ②グレーのピン ③黒い吹き出し の**3つが重なって**いた。
  ピンが車体の上に乗って絵として読めない状態
  → **通常時はピンを出さない**。クリック対象（ポップアップ）はナンバー吹き出し側に移した。
    「車の位置を直す」モード中だけ、つまみ（青い丸）を出す＝**常に1車両1オブジェクト**
- **吹き出しを小さく**: 角丸を詰め、文字を1〜2pt 縮小。状態は右上の色ドットで示し、
  **「稼働外」の文字は出さない**（全車に同じ文字が並んでも情報量が無い）
- **「積み込み中」を導入**（ユーザー案）: 専用の記録が無いので、
  **拠点（倉庫・拠点ピン）から 120m 以内に停まっている稼働中**を積み込み中と推定する。
  拠点は既存の `map_places` をそのまま使う。あくまで推定なので断定的な表現は避けている
- **車種・車体色の受け皿**（migration 123・要適用）: `vehicles.model_key` / `vehicles.body_color` を追加。
  地図は `model-color` に車体色を流す（未設定は白＝モデル本来の色）。
  車種の出し分けはモデルが揃ってから
- `docs/assets-todo.md` に方針を追記: **複数車種（クリッパー/エブリイ等）を色変更できる形で**。
  着色を効かせるため**車体マテリアルは無彩色**にし、窓・タイヤ・ライトは別マテリアルに分ける
- 検証: web tsc クリーン・テスト 439 passed・next build 成功

### 補足（2026-08-10 18:45）: マイグレーション未適用でも地図を落とさない

- **重要**: 現在の作業は `main` に載っており、main は**本番（nippo-ace）へ自動デプロイ**される。
  地図APIは migration 122（`vehicle_positions`）と 123（`model_key`/`body_color`）に依存するため、
  **本番DBに未適用だと地図とダッシュボードのカードが 500 で落ちる**
- 対策として API にフォールバックを入れた:
  - 123 未適用 → 新カラム無しの select で取り直す
  - 122 未適用 → **従来どおり打刻GPSから位置を導出**するモードで動く（手動配置は使えないが地図は生きる）
  - 業務画面を止めないことを優先（プランと課金の設計で決めた原則と同じ）
- `docs/design/map-board.md` に §7 車両3Dモデル（車種・車体色）と §8「積み込み中」の推定を追記
- 残: **本番DBへ migration 122・123 を適用**（dev には適用済み）

## 2026-08-10 18:55 拠点ピンを地点検索から立てられるようにした

- 従来は「地図をクリックして置く」だけで、**住所や施設名しか分からない拠点は置けなかった**
- **Mapbox Geocoding v6 での地点検索**を地図左上に常設（`can_manage_org_settings` を持つ人のみ）:
  - 入力から 400ms デバウンスで検索（1文字ごとに叩かない）。日本国内・日本語に限定し、
    **地図の中心を proximity に渡して近い候補を上位**に出す
  - 候補は「名称＋住所」で表示。選ぶとその場所へ flyTo（zoom 16）し、拠点の下書きになる。
    **名称も候補名で自動入力**（空のときだけ。手入力を上書きしない）
  - トークンは NEXT_PUBLIC（公開用）なのでクライアントから直接呼ぶ。サーバー経由にはしない
- **下書きの仮ピンをドラッグ可能に**した。検索結果は建物の中心などにズレることがあり、
  「12番の区画」のような精度が要る拠点はつまんで直せる必要があるため。
  フォームにも「位置はドラッグで微調整できます」と明記
- 検証: web tsc クリーン・テスト 439 passed・next build 成功

## 2026-08-10 19:00 地点検索を POI 対応にし、ガソリン・駐車場・運送会社のショートカットを追加

- **重要な作り直し**: 前回入れた検索は **Mapbox Geocoding v6** だったが、v6 は住所・地名しか返さず
  **施設（POI）が出ない**。「ヤマトの営業所」「この辺のガソリンスタンド」は原理的に引けなかった
  → **Search Box API（`/search/searchbox/v1/forward`）へ差し替え**（types=poi,address,place,street）
- **種別ショートカット**を検索ボックス下にチップで常設（ユーザー指摘「ガソリン・駐車場・ヤマトの営業所は
  調べることが多い」）:
  - ガソリン（`gas_station`）/ 駐車場（`parking_lot`）/ コンビニ（`convenience_store`）は**カテゴリ検索**
    （`/search/searchbox/v1/category/...`）。名前を知らない場所は種別からしか探せないため
  - ヤマト運輸 / 佐川急便は**ブランド名のテキスト検索**（カテゴリより確実に当たる）
  - いずれも地図の中心を proximity に渡すので「いま見ている辺り」を探す
- **種別を拠点の初期選択に引き継ぐ**: ガソリンで探して選べば「給油所」、駐車場なら「駐車場」が
  最初から選ばれる。拠点の種別に **`fuel`（給油所）を追加**（API の許可リストと UI アイコン）
- 検索結果は最大8件・スクロール可、「この辺りの候補 N 件／閉じる」を付けた
- 検証: web tsc クリーン・テスト 439 passed・next build 成功

## 2026-08-10 19:05 検索ボックスが 2D/3D 切替と重なる問題を修正

- 検索UIを `absolute left-3 top-3` で置いたため、**同じ座標にある既存のコントロール
  （2D/3D・設定・共有）と完全に重なっていた**（スクショで確認）
- 既存の左上スタック（`flex flex-col gap-2`）の**子として入れ直し**、縦に並ぶようにした。
  ショートカットのチップも同じ流れに乗る
- 検索結果のリストだけは `absolute top-full` で**浮かせる**（下の共有ボタン等を押し下げないため）。
  幅は `min(320px, 100vw-3rem)` でスマホでも収まる
- 検証: web tsc クリーン・next build 成功

## 2026-08-10 19:15 検索を Google マップ相当に（範囲限定・結果ピン・番号連動・エリア再検索）

スクショ3枚の指摘「どの範囲で検索していて、それぞれどこにあるのか分からない」への対応。

- **検索範囲を「いま表示中の地図」に限定**（`bbox`）。proximity だけでは全国から混ざり、
  「ヤマト 営業所」で**埼玉・千葉の営業所**まで出ていた（3枚目のスクショ）
- **結果を地図にピンで出す**。拠点ピン（登録済み）と区別するため、白地＋**番号**＋種別アイコンにした。
  一覧の行にも同じ番号を振り、**ホバーで相互に強調**（一覧↔地図を目で結べる）。ピンのクリックでも選べる
- **「このエリアを再検索」**を地図中央上に出す（検索後に地図を動かしたときだけ）。
  Google マップの「このエリアを検索」と同じ考え方で、範囲が変わったことを利用者に委ねる
- 見出しを「この辺りの候補」→**「いま表示中の範囲から N 件」**に変更（どこを探したかを明示）
- 取得件数を 8→10 に
- 検証: web tsc クリーン・テスト 439 passed・next build 成功
- 残: Google マップ相当にするなら次は「結果カードに写真・営業時間」だが、Mapbox の POI には
  それらが無い。必要なら Google Places API の併用を検討する（コストと規約の話になる）

## 2026-08-10 19:35 拠点の編集と「範囲（円）」での登録

- **編集**（要望「登録した地点の移動や名称変更」）: 拠点ピンのクリックで編集パネルが開く。
  名称・種別・範囲を変更でき、**ピンはドラッグで移動**できる。キャンセルはサーバー値を取り直して戻す。
  削除は既存の確認ダイアログに合流させた
- **範囲（要望「点ではなく範囲で登録したい」）**: migration 124 で `shape` / `radius_m` / `geometry` を追加し、
  **まず円（中心＋半径）を実装**。スライダー1本で 0〜1000m（0=点のまま）。
  Mapbox に円プリミティブが無いので**64角形のポリゴンに落として**塗る（紫の面＋輪郭）
  - 段階を分けた理由: 円は UI がスライダー1本で済み、敷地や「この辺り」には十分。
    **ポリゴン（配達エリア）は描画ツールが要る**ので後段（`@mapbox/mapbox-gl-draw` 導入か自前実装かの判断待ち）
  - 円の半径は将来「積み込み中」の判定にもそのまま使える（いまは固定 120m）
- API: `PATCH /api/admin/map/places/[id]` を追加（名称・種別・座標・半径）。POST も半径を受ける
- 検証: web tsc クリーン・テスト 439 passed・next build 成功
- **残: migration 124 の適用**（未適用でも一覧は動くが、shape/radius_m が無い分 select が失敗する可能性あり）

## 2026-08-10 19:50 配達エリア（コースの面）を多角形で描けるようにした

- 方針（ユーザー合意）: **配達エリアは courses の属性**。拠点（map_places）は点・円のまま。
  同じ「範囲」でも意味が違う（拠点の円＝その場所の広がり / コースの面＝担当する区域）
- **migration 125**（要適用）: `courses.delivery_area`（GeoJSON Polygon/MultiPolygon）＋
  `delivery_area_updated_at` / `delivery_area_updated_by`。**誰がいつ引いたかを残す**
  （区域の線引きは揉めやすいので後から辿れるように）。PostGIS は入れず jsonb で持つ
- **`@mapbox/mapbox-gl-draw` を採用**（ユーザー判断）。1.5.1 を導入
  - **編集中だけ地図に載せる**。常時載せるとクリックが Draw に吸われ、拠点の選択や車両の配置が効かなくなる
  - 既存エリアがあれば読み込んで**修正**できる（引き直しではない）。複数描いたら MultiPolygon にまとめる
- 表示: コース色で塗り分け（fill 14% / line 85%）＋コース名のラベル。編集中のコースは Draw 側が描くので二重に出さない
- API: `GET /api/admin/map/course-areas`（一覧・migration 未適用でも落ちないフォールバック付き）、
  `PUT/DELETE /api/admin/map/course-areas/[id]`（`can_manage_courses`）。
  3点未満の «面» は弾く（閉じた環なので最低4点）
- 検証: web tsc クリーン・テスト 439 passed・next build 成功
- **残: migration 124・125 の適用**

## 2026-08-10 20:00 地図UIの再設計を起票（利用者起点・駐車区画の向き）

- ユーザー提起「軽配送の業者がどう使うのか、運営・ドライバー両方で検討して考え直したい」＋
  「駐車スペースは長方形で指定して、その向きに車を合わせたい」→ `docs/design/map-ux.md` を起票
- **場面から洗い直した**（朝・日中・突発・夕方 × 運営／ドライバー）。現状の地図が答えられていない
  ことを表で明示。**最大の指摘は「ドライバー側に地図が無い」**こと。
  地図は運営の監視ツールとして育ってきたが、毎日いちばん必要としているのはドライバー
  （今日の車がどこに停まっているか／センターの入口／担当エリア）
- 提案は2画面:
  - 運営「今日の盤面」= **左リストが主役**、地図は背景。**未出勤の人は位置が無いので地図の外に出す**
    （朝いちばん重要なのに、いまは地図に描けないので存在しないことになっている）
  - ドライバー「今日の道具」= 俯瞰の縮小版を作らない。**車の駐車区画・センター入口・担当エリア**の3つだけ
- **駐車区画のモデル案**: `parking_slots`（place_id・label「12番」・矩形 geometry・bearing・vehicle_id）。
  **矩形の長辺から向きを自動算出**して人に角度を入力させない。車両描画時は区画内なら
  `model-rotation` に区画の bearing を使う。区画に定位置の車両を持たせると
  ドライバーの「今日の車どこ？」に直接答えられる
- `decisions-pending.md` に D2 として4つの判断を追加（実装は判断待ち・コード変更なし）

## 2026-08-10 20:15 地図UI再設計への回答を反映（未出勤の見せ方・向き・進捗）

ユーザーからの実務的な指摘を設計に反映（`docs/design/map-ux.md`）。

- **進捗の地図表示は「やらない」に確定**。ヤマト・Amazon は**独自アプリに閉じており構造的に取れない**、
  郵便局系はゼンリン連携アプリ（GODOOR 等）前提、ACE CREATION はヤマトがメイン。
  → 「取れないデータを前提にした画面」を作らないこと自体を設計判断として記録
- **駐車区画の向きは人に指定させない**（「その時々でしょうし、反対向いていてもまあいい」）。
  矩形の長辺が自動的に車の軸になる。前後は問わない。将来 GPS/モーションから推定して精度を上げる余地は残す
- **ドライバー地図は mobile 機能・リアルタイムGPS の後**に。番地・表札まで要る場面は
  **ゼンリンAPI 導入が前提**（Mapbox では番地レベルに限界）
- **「未出勤が見えない」問題を、地図を小さくせずに解く案**に書き換えた（サイドリスト案は撤回）:
  1. **ゴーストピン** — 未出勤の人を「本来いるはずの場所」（割当車両の駐車区画／コースの集合場所）に
     薄く立てる。空の区画に人影が立つ絵で「来ていない」を地図の言語で表す
  2. **細い要対応ストリップ**（1行・何も無ければ出さない）→ タップで**半透明オーバーレイ**（押し縮めない）
  3. **ワンタップ電話**（`tel:`）＋LINE＋代走探し。電話番号は PII なので `can_view_members` 限定
- 残る論点は3つに絞った（ゴーストピンの優先順・電話の権限・**ゼンリンAPI 導入判断**）

## 2026-08-10 20:30 場所の意味の整理・遅刻予兆通知の設計・ゼンリン見送り

- **ゴーストピンは駐車区画優先**（車が無い単発案件は集合場所）で決定。電話権限は `can_view_members` で決定
- **「場所」の意味を分けることにした**（ユーザー提起「稼働開始を押す場所＝集合場所、センターなど
  その後行く場所は別」）。いまは `courses.meeting_place` が文字列1つで**出発地と行き先が混ざっている**:
  - **出発地**（稼働開始を押す場所・ふつうは車の駐車区画）… ゴーストピンもここに立てる
  - **立ち寄り先**（センター等・順序付き）
  - 名称は「集合場所」だと**複数人が集まる語感**で、1人で駐車場から始まる実態とズレる → **「出発地」**を推す（保留）
- **遅刻の予兆通知を設計**（map-ux.md §7）。**重要な制約**: 勤務時間外は GPS を取らない方針なので
  **始業前の居場所は分からない**＝「あと何分で着くか」は計算できない。計算できるのは
  **「出発地を何時に出れば立ち寄り先に間に合うか」＝出発期限**。判定は稼働開始（QR打刻）の有無で行う
  - T−15分 ドライバーへ／T+5分 再通知／**T+10分 運営へ**（運営を煩わせるのは最後）
  - 所要時間は①コースに手入力で開始、②必要なら Mapbox Directions の自動見積りを足す
  - 誤検知を出さない: 希望休・欠勤は対象外、稼働開始済みは対象外、1日1回だけ
- **ゼンリンAPI は見送り**（初期40万円弱＋月6万円＋従量。回収の見込みが立たない）。
  → **番地・表札レベルを前提にした機能は設計に入れない**。ドライバー地図は Mapbox の精度で
    成立する3点（車の場所・センター入口・担当エリア）に絞る。複数社で費用按分できる形が見えたら再検討
- roadmap トラック K に「遅刻の予兆通知」「場所の分割」を追加

## 2026-08-10 20:50 駐車区画（parking_slots）を実装

- **migration 126**（要適用）: `parking_slots`（org / place_id / label「12番」/ geometry / bearing /
  代表点 lat,lng / vehicle_id）。`vehicle_id` は部分ユニーク（1台の定位置は高々1つ）
- **向きは人に指定させない**（決定どおり）。**サーバーで矩形の長辺から bearing を算出**する。
  クライアントにも角度を持たせない
- **描くのはざっくりでよい**: 描いた多角形を**最小面積の長方形にスナップ**してから保存する
  （航空写真の上で4点をきっちり打つのは難しい）。回転キャリパー相当を各辺の角度で総当たりして実装
- **航空写真に自動で切り替える**（ユーザー方針「航空写真を見ながら設定すれば実際のものに合う」）。
  区画設定に入ると basemap=satellite・zoom 19 へ寄る
- **連続入力**: 保存すると描画をクリアし、区画名を「12番」→「13番」に自動で進める（駐車場は連番が普通）
- **車の向きを区画に合わせた**: 車両位置が区画の中なら `model-rotation` に区画の bearing を使う
  （区画外は正面固定。GPS の heading が入ったらそれを使う）。点の内外判定はレイキャスティング
- 表示: 区画は水色の面＋白い輪郭＋区画名。API は `can_manage_org_settings`（GET は can_view_vehicles）
- 検証: web tsc クリーン・テスト 439 passed・next build 成功
- **残: migration 124・125・126 の適用**。区画の編集（名称変更・形の修正・削除）UI は PATCH/DELETE の
  API まで用意済みで、画面はまだ（次に足す）

## 2026-08-10 21:15 区画が画面に出ない／多角形ツールが再起動できない問題を修正

- **区画が出ない真因**: 面のレイヤー（駐車区画・配達エリア・拠点の円）を**データ側の effect で
  `addSource` していた**。区画設定に入ると航空写真へ `setStyle` するため、
  **スタイル差し替えでソースごと消え**、その後は「ソースが無い＝作り直す」条件に入っても
  タイミング次第で再生成されず、保存済みの区画が描かれないままだった
  → 3Dモデルと同じ実績ある流れに統一: **レイヤーは地図の初期化時に空で作り、`style.load` で作り直す。
    データ側は `setData` だけ**（`applyAreaDataRef` 経由でスタイル再読込時にも流し直す）
- **多角形ツールが再起動できない**: 保存後に `draw.deleteAll()` するだけだと `simple_select` のままで、
  ツールが押せない状態になっていた → 保存後に **`draw.changeMode("draw_polygon")`** で描画待ちへ戻す
- **保存されたことがその場で分かるように**、作成パネルに**保存済み区画の一覧**（クリックで寄る／削除）を追加
- GET が失敗したとき `reason` を返すようにした（黙って空を返すと「消えた」に見えるため）
- 検証: web tsc クリーン・テスト 439 passed・next build 成功

## 2026-08-10 22:05 Meshy 出力の整形パイプラインを作成（clipper.glb）

- ユーザーから Meshy.ai の生成結果（NISSAN クリッパー）を受領。**そのままでは載せられない**ことを実測で確認:
  **199万三角形 / 34MB / POSITION 属性のみ（法線・UV・マテリアル無し）/ 正規化スケール / 原点=中心**
- `scripts/prepare-vehicle-glb.mjs` を作成し、**Blender 無しで整形できる**ようにした:
  ①目標三角形数まで簡略化 ②実寸へスケール ③**原点を底面中心へ** ④法線が無ければ生成
  ⑤マテリアルが無ければ無彩色を付与
- 実測: **199万→1.6万三角形 / 34MB→277KB / 3.40×1.92×1.96m / 原点=底面中心**。
  `apps/web/public/models/clipper.glb` として出力済み
- **Draco 圧縮はしない**と決めた。Mapbox の model レイヤーが読める保証が無く、
  動いている truck.glb も非圧縮のため（一度 Draco 版を作ったが 59KB→277KB に戻した）
- Meshy 側の残作業: **「テクスチャ」工程まで回す**（generate 段階は POSITION のみ）。
  テクスチャ版なら法線・UV が入り、④⑤が不要になり見た目も良くなる。車体は白〜薄グレーのまま
- 検証: 生成物の属性・寸法・原点を glb のヘッダから確認済み。地図への接続（model_key での切替）は次

### 補足（2026-08-10 22:10）: 車両3Dモデルの受け渡し手順

1. Meshy で **「テクスチャ」工程まで**回して glb をダウンロード（generate 段階は POSITION のみ）
2. `apps/web/public/glb/` に置く（作業用。整形後の成果物は `apps/web/public/models/`）
3. `node scripts/prepare-vehicle-glb.mjs <入力.glb> apps/web/public/models/<車種>.glb 3.4 16000`
4. 車体は白〜薄グレーのまま（`model-color` で着色するため）
- 現状: `clipper.glb`（1.6万三角形・277KB・実寸・原点=底面中心）を生成済み。
  地図への接続（`vehicles.model_key` での車種切替）は未実装＝次の作業

## 2026-08-10 22:25 エブリイ（テクスチャ版）を整形し、車種の出し分けを実装

- ユーザーから **スズキ エブリイのテクスチャ版**（4K）を受領。クリッパー（generate 段階）と違い
  **NORMAL / TANGENT / TEXCOORD_0 と3枚のテクスチャ**（base_color / metallic_roughness / normal）を持つ
- **テクスチャ縮小をパイプラインに追加**（既定 1024）。4K のままだと **1台で 92MB**。
  地図上の車は画面で数十pxなので 1K で十分
- 実測: **92.45MB → 1.26MB**（三角形 198万→1.6万、テクスチャ 8.8+1.8+7.2MB → 206+159+101KB）。
  寸法 3.40×1.90×1.85m・原点=底面中心
- **車種の出し分けを実装**: `VEHICLE_MODELS`（every / clipper / truck）を全部 `addModel` し、
  レイヤーの `model-id` を `["coalesce", ["get","model"], DEFAULT]` に。
  車両ごとの `vehicles.model_key` を feature プロパティに流す。**既定は every**
  （テクスチャ付きで実車ベース。従来の Kenney 汎用バンより明確に良い）
- 検証: web tsc クリーン・テスト 439 passed・next build 成功。glb のヘッダで属性・寸法・原点を確認
- 残: ①**クリッパーもテクスチャ工程を回して再生成**（現状は無彩色・法線はこちらで生成した近似）
  ②車両編集画面から `model_key` / `body_color` を選ぶ UI（いまは DB 直・未設定は every で描画）

### 補足（2026-08-10 22:30）: テクスチャ解像度の指針と現在のモデル構成

- **4K は不要**。地図上の車は画面で数十pxなので **1K で十分**（寄っても足りる）。
  Meshy 側で落とせるなら 1K〜2K、4K のままでもパイプラインが縮小するので受け取り自体は問題ない
  - 引数で変更可: `node scripts/prepare-vehicle-glb.mjs <入力> <出力> 3.4 16000 <テクスチャ px>`
- 現在のモデル構成（`apps/web/public/models/`）:
  - `every.glb` … スズキ エブリイ（テクスチャ版・1.26MB）**＝既定モデル**
  - `clipper.glb` … 日産 クリッパー（generate 版・無彩色・法線は近似生成・277KB）
  - `truck.glb` … 旧 Kenney 汎用バン（CC0・112KB）。後方互換のため残置
- 残: ①クリッパーのテクスチャ版の再生成（ユーザー） ②車両編集画面での車種・車体色の選択UI（こちら）

## 2026-08-10 22:40 クリッパー（テクスチャ2K）を取り込み、車種・車体色を車両登録から選べるように

- **クリッパーのテクスチャ版**を受領し整形: 8.94MB → **1.91MB**（三角形1.6万・実寸3.40m・原点=底面中心・
  テクスチャ1K）。これで every / clipper とも実車ベース＋テクスチャ付きに揃った
- **`src/lib/vehicleModels.ts`（新規）にカタログを集約**。地図と車両登録の両方がこれを見る:
  - `VEHICLE_MODELS`（key / メーカー / 車種名 / url / 別名）
  - `resolveModelKey(manufacturer, brand)` … **車種名から3Dモデルを自動決定**。
    「エブリィ」「エブリー」「NV100」などの表記ゆれを別名で吸収し、「エブリイワゴン」等の派生も前方一致で拾う。
    メーカーが入力されていて食い違う場合は採用しない（別メーカーの同名車を誤って当てない）
  - 表に無い車は既定モデル（every）で描く。**描けないより、それらしく描く方がよい**
- **車両登録・編集の UI**:
  - メーカー名・車種名を **datalist で選択式（自由記入も可）**に。表に無い車も従来どおり登録できる
  - 「地図では ◯◯ の3Dモデルで表示されます」/「まだ無いため標準の軽バンで表示されます」を明示
  - **車体色**をプリセット6色＋カラーピッカーで選択（未設定に戻せる）。`#RRGGBB` のみ受け付ける
- API: POST/PUT で `modelKey` / `bodyColor` を受け、GET の一覧にも含める
- 検証: web tsc クリーン・テスト 439 passed・next build 成功
- 残: 実機（dev）で車両を登録して地図の見え方を確認。他車種（ハイゼット等）が要れば同じ手順で追加

## 2026-08-10 22:45 モデルを「地図の抽象度」に合わせる（style=flat を既定に）

- ユーザー指摘「いくら何でもリアルすぎる／ハコ虎の画面に合うように」への対応。
  Meshy のテクスチャ版は写真起こしの質感で、**暗く抽象的な地図から浮く**
- `scripts/prepare-vehicle-glb.mjs` に **`style` 引数（既定 flat）** を追加:
  - テクスチャ（base_color / metallic_roughness / normal）を外し、
    **UV・接線も削除**（接線は頂点あたり4floatでファイルの大半を占めていた）
  - 無彩色・metallic 0・roughness 0.75 のフラットなマテリアルにする
  - 実測: エブリイ 1.26MB → **443KB** / クリッパー 1.91MB → **717KB**
- **写実を捨てる理由**（設計 §11 に記録）: ①地図の縮尺では質感が見えない ②焼き込まれた影・汚れが
  `model-color` の着色を濁らせ、**車体色を選べる設計と相性が悪い** ③建物がフラットな中で車だけ
  写真的だと視線が車に張り付いて地図が読めなくなる
- 実物に寄せたい場面（車両詳細のプレビュー等）が出たら `style=photo` で別ファイルを作れる
- 検証: next build 成功・テスト 439 passed
- 残: ナンバープレートの3Dへの表示は**見送り推奨**（理由は次の回答に記載）。dev で見た目を確認

## 2026-08-10 23:00 ナンバープレートを別マテリアルに切り出し（黒ナンバー化）

- モバイルで 3D モデルを大きく出す予定のため、プレートの見た目が効いてくる。
  生成モデルのままだと「EVERY」ロゴや黄色いプレートが出てデジタルツイン感が落ちる（ユーザー指摘）
- パイプラインに**プレート面の切り出し**を追加。幾何条件で判定する:
  端（X外側6%）・地上0.25〜0.72m・中心±0.22m・前後を向いた面（法線X成分>0.75）
  → 前後2枚で **370〜380 三角形**が該当。既定色 **#111827（事業用＝黒ナンバー）**、第7引数で変更可
- **マテリアルを分ける意味**: モバイル（three.js 等）でプレートだけ差し替え・着色でき、
  将来プレート番号のテクスチャを貼る受け皿にもなる
- Mapbox の `model-color-mix-intensity` を 0.85 → **0.55** に下げた
  （強く混ぜると車体色がプレートの黒まで染めてしまうため）
- 実測: every 537KB / clipper 862KB（フラット＋プレート分離）
- 検証: next build 成功
- **残**: ユーザーが Illustrator でプレート書体を SVG 化（著作権・余白のばらつき・環境依存の回避）。
  入ったら ①地図の吹き出し ②VehiclePlate ③3Dのプレートテクスチャ の3箇所で共用する

## 2026-08-10 23:10 地図が表示されない不具合を修正（addSource の例外・glb がロードできない）

実機のコンソールから2件の障害を特定。

- **「Style is not done loading」で画面が出ない**: 面レイヤーを作る `addAreaLayers()` を
  初期化直後に**無条件で呼んでいた**ため、スタイル読込前の `addSource` が throw し、
  **地図の初期化 effect ごと止まっていた**（＝画面が出ない）
  → `map.isStyleLoaded()` を確認してから触るようにした（関数の冒頭と初回呼び出しの両方）
- **「Could not load model … RangeError: offset is out of bounds」**: 車両モデルが読めない。
  原因は**プリミティブ間でアクセサを共有していた**こと（プレートを別マテリアルに切り出した際、
  頂点データは共有したままにしていた）。Mapbox の model ローダーがこれを扱えない。
  動いている `truck.glb` は「1プリミティブ・**uint16** インデックス」だった
  → パイプラインに「**プリミティブごとに頂点を詰め直し、可能なら uint16 インデックスにする**」処理を追加。
    結果: every 453KB / clipper 727KB、両方とも uint16・アクセサ独立
- 教訓: **動いている資産（truck.glb）と構造を突き合わせる**のが最短だった。
  ローダーの許容範囲は仕様書より既存の実物が語る
- 検証: web tsc クリーン・テスト 439 passed・next build 成功

## 2026-08-10 23:25 車両編集に3Dプレビューと会社の色パレットを追加

- **3Dプレビュー**（`VehicleModelPreview`・three.js 0.180 を新規導入）: 車両編集画面で
  その車の3Dモデルをゆっくり回しながら表示し、**選んだ色がその場で反映される**。
  地図と同じ glb をそのまま読む（実寸・原点=底面中心・フラット・プレート別マテリアル）
  - **車体色は `plate` 以外のマテリアルにだけ効かせる**（黒ナンバーを保つ）
  - 色変更でモデルを読み直さない（読み直すと一瞬消えてちらつく）
- **会社の色パレット**（migration 127・要適用）: `organizations.vehicle_body_colors`。
  白・グレー・黒は常設、それ以外は**選ぶと会社の色として貯まり、次の車両からは選ぶだけ**。
  上限12色・重複は無視・直近に使った色を先頭に。API は
  `GET/POST/DELETE /api/admin/org/vehicle-colors`（POST/DELETE は `can_manage_vehicles`）
  - パレットへの追加に失敗しても、その車の色自体は保存できる（致命的にしない）
- **メーカー・車種は登録後に編集不可**にした（ユーザー指摘「実車のメーカーと車種は変わらない」）。
  一方**色は塗り直し、ナンバーは変更があり得る**ので編集できるままにする
- 検証: web tsc クリーン・テスト 439 passed・next build 成功
- **残**: セレクトボックス（datalist）の見た目が悪いという指摘への対応。
  新規登録時の車種選択を、datalist ではなく**カード/チップ選択＋「その他（自由入力）」**に作り替える

## 2026-08-10 23:35 車種選択をチップ式に作り替え、カタログとモデルを分離

- 指摘「セレクトボックスの UI が終わっている」への対応。**datalist をやめ、メーカーごとに
  まとめたチップから選ぶ**形に。カタログに無い車は「一覧にない車を入力」で自由入力できる
- **カタログ（車種）と 3D モデルを別の表に分けた**（ユーザー「アトレーやミニキャブも早く追加したい」）:
  - `KEI_VANS` … 車種カタログ。**モデルが無い車種も載せる**
    （スズキ エブリイ / 日産 クリッパー / ダイハツ ハイゼットカーゴ・アトレー / 三菱 ミニキャブ /
     ホンダ N-VAN / トヨタ ピクシスバン / マツダ スクラム / スバル サンバー）
  - `VEHICLE_MODEL_URLS` … 実際に用意できた glb（いまは every / clipper の2つ）
  - **分けた理由**: 車種は先に増えるが 3D モデルは1台ずつ作るので追いつかない。
    モデルが無くても車種は正しく選べるようにしておき、glb が揃ったら `modelKey` を埋めるだけで切り替わる
  - モデル未用意の車種はチップに「・標準モデル」と添える（**嘘をつかない**）。
    軽バンは形が似ているので既定モデルでも違和感は小さい
- 登録後は車種を**表示のみ**（「登録後は変更できません」）。色とナンバーは編集可のまま
- 検証: web tsc クリーン・テスト 439 passed・next build 成功
- 残: migration 127 の適用。アトレー等の glb ができたら `KEI_VANS` の `modelKey` を埋めるだけ

## 2026-08-10 23:40 世代（型式）に対応 — 同じ車種でも年代で形が違う問題

- ユーザー指摘「同じ車種でも年代によって全然形が違う」への対応
- **識別子は「型式」にした**（年式ではなく）。理由:
  ①**車検証に必ず載っていて現場で確実に読み取れる** ②年式（登録年）よりも正確
  ③OEM 関係も型式で追える（クリッパー DR17V ＝ エブリイ DA17V の OEM）
- **migration 128**（要適用）: `vehicles.model_code`（例: DA17V）
- カタログを世代対応に拡張（`KeiVanGeneration`）。エブリイ DA17V/DA64V、クリッパー DR17V/DR64V、
  ハイゼットカーゴ S700V/S321V、ミニキャブ DS17V を登録。**型式は車検証で確認するのが正**なので、
  この表はあくまで入力の手がかり。一致しないときは自由入力できる
- **モデル解決の順序**: 型式が分かればその世代のモデル → 分からなければ車種の既定（現行世代）→ 標準の軽バン
  - **型式が分かっているのにその世代のモデルが無い場合、車種の既定で代用しない**。
    形が違う世代を出すくらいなら標準の軽バンの方が誤解が少ない
- UI: 車種チップの下に**型式チップ＋自由入力**（車検証の「型式」欄）。
  3Dプレビューも型式を反映する。編集画面では型式も併記
- 検証: web tsc クリーン・テスト 439 passed・next build 成功
- 残: migration 127・128 の適用。世代ごとの glb ができたら `KEI_VANS` の `generations[].modelKey` を埋める

## 2026-08-10 23:55 3Dプレビューの不具合修正と、マテリアル分けを Blender 手作業へ

- **プレビューが枠からはみ出す**: `renderer.setSize(w, h, false)` の第3引数（updateStyle=false）で
  canvas に CSS サイズが付いていなかった。`setSize(w, h)` に直し、枠に `overflow-hidden` を追加。
  カメラ距離も視野角と縦横比から計算して**必ず収まる**ようにした
- **粘土っぽい見た目**: 平行光だけだったため。`RoomEnvironment` の環境マップを入れ、
  面の向きに応じた明暗が出るようにした
- **窓が車体色と一緒に変わる問題**: テクスチャの明度から窓・タイヤを自動判別する実装を試したが、
  **写真由来テクスチャの UV とサンプリングが噛み合わず、車体に黒い斑が散った**
  （headless Chrome + three.js でレンダリングして確認）→ **撤去した**
  - 形状からも判定できない（窓とボディは連続した面）
  - → **マテリアル分けは Blender で手作業**に切り替える。手順を
    `docs/design/vehicle-3d-blender.md` に起票（body / glass / dark / plate の4マテリアル）
  - アプリ側は**マテリアル名で着色対象を選ぶ**（`body` だけに色を効かせる）
- 検証: web tsc クリーン・next build 成功。モデルは16k・フラット・プレート分離の状態に戻した

### 補足（2026-08-11 00:05）: Blender 作業の入力ファイルと、パイプラインの受け入れ

- **触るのは Meshy の元ファイル**（`apps/web/public/glb/Meshy_AI_*_texture.glb`）。
  整形後（`public/models/*.glb`）はテクスチャを捨てているので、どこが窓か分からず作業に向かない
- パイプライン側を**Blender の成果物を尊重する**ように調整:
  - `plate` マテリアルが既にあれば、プレートの自動切り出しを**スキップ**（二重に作らない）
  - `glass` / `dark` / `plate` は**色をそのまま保つ**。テクスチャだけ外し、`body` 相当のみ無彩色に整える
- 作業後は `node scripts/prepare-vehicle-glb.mjs <blender出力> apps/web/public/models/<車種>.glb 3.4 16000 1024 flat`

## 2026-08-11 00:15 スマートトポロジー版の評価と、プレート自動切り出しの見直し

- ユーザー提供の**スマートトポロジー版**（ホンダ アクティ）を実測・レンダリング検証:
  **13,098三角形 / 0.23MB / 整ったトポロジー**（通常生成は約200万・34〜92MB）
  → **こちらを入力にすべき**と結論。理由: ①削減が要らない（200万→1.6万に潰すと形が甘くなり
    「粘土っぽさ」の原因になる）②**Blender の面選択（L・ループ選択）が効く**のは整ったトポロジーだけ
    ③軽い。テクスチャが無い点は、どのみち捨てるので問題にならない
- パイプラインを通して確認: 法線生成・実寸化・原点補正まで問題なく通り 233KB
- ただし**プレートの自動切り出しが外れた**（バンパーに黒い破片が出た）。モデルによって当たり外れがある
  → 第8引数 `plateMode` を追加（`auto`（既定）/ `none`）。**Blender で `plate` を分ける場合は none**
- `docs/design/vehicle-3d-blender.md` に §0 として「スマートトポロジー版を使う」を追記

## 2026-08-11 00:25 窓・タイヤの自動分離は不可能と確定（UVアトラスの構造）

- テクスチャ付きスマートトポロジー版（アクティ・13,098三角形・7.5MB）を受領。
  **入力としては理想**（整ったトポロジー＋テクスチャ＋法線＋UV）
- 「UV が整っていれば明度で窓・タイヤを分けられるのでは」と再挑戦したが、**やはり黒い斑が散った**。
  頂点サンプル→重心サンプル（4点中央値）と改良しても改善せず
- **base_color アトラスを書き出して原因を特定**: Meshy の UV は**細かく分割された島**が並び、
  **島と島の間が濃いグレーの余白**で埋まっている。島が小さいため三角形の内側を取っても余白を拾う。
  スマートトポロジー版でも島は細かく、同じ結果になる
  → **自動分離は打ち切り**。`darkSplit` は既定 `none`（試したい場合のみ `auto`）
- **窓・タイヤの分離は Blender で手作業**が確実、と設計書にも根拠付きで記録
- モデルは every 453KB / clipper 727KB（フラット＋プレート分離）に戻して確定
- 教訓: 見た目の問題は**実際にレンダリングして確認する**。今回は headless Chrome + three.js で
  2回とも即座に破綻が分かった。アトラスを1枚書き出したのが決め手だった

### 補足（2026-08-11 00:30）: Blender のインポート設定

- ユーザーからインポート画面の確認依頼 → **既定のままで問題ない**と回答。
  「画像をパック」オン／シェーディング=法線データを使用／照明モード=標準。ボーン関連は無関係
- 作業のコツを手順書に追記: ①ビューポートを **マテリアルプレビュー（`Z`）** にしてテクスチャを見る
  ②**面選択（`3`）→ `L`（リンク選択）** でまとまった面を取る ③**X-ray はオフのまま**
  （オンだと裏側＝車内側の面まで選択されてしまう）
- スケールは Blender で直さなくてよい（書き出し後にパイプラインが実寸へ直す）

## 2026-08-11 00:40 「塗り分けマスク」方式で解決（Blender の手作業が不要に）

- ユーザーのスクショで**決定的な事実**が判明: スマートトポロジー版は**窓が「描いてあるだけ」で
  形状が無い**（メッシュは均一な格子で、窓の輪郭を無視している）。
  → **面では選び分けられない**。Blender で手作業しても選択が窓枠からはみ出す
- **解決: テクスチャを白黒の「塗り分けマスク」に変換して残す**（`style=masked`・**既定に変更**）
  - 明るい部分（車体）を白へ持ち上げ、暗い部分（窓・タイヤ・グリル）は暗いまま残す
  - 描画側で色を**乗算**すれば車体だけが着色される。three.js は `material.color` が乗算なのでそのまま成立
  - Mapbox は混色なので `model-color-mix-intensity` を 0.45 に抑えた
  - **レンダリングで確認**: 赤に着色 → 車体だけ赤、窓・タイヤは黒のまま、グリルやドアの筋も残る
- 3車種を masked で再生成: every 769KB / clipper 1175KB / acty 620KB。**アクティをカタログに追加**
- `docs/design/vehicle-3d-blender.md` の冒頭に「**Blender でのマテリアル分けは不要になった**」と明記
  （手作業の手順は参考として残置）
- 教訓: ユーザーのスクショ1枚（選択範囲が窓からはみ出す図）が原因の特定に直結した。
  「窓が形状として存在しない」と分かった瞬間に、面選択という前提ごと捨てられた

## 2026-08-11 00:50 3Dプレビューの見せ方を調整（回転を止める・接地影・トーン）

- 指摘「回転してるとリアが見えちゃう」への対応。**生成モデルはリアの造形が実車と違う**
  （1枚の写真から裏側を想像するため）ので、**粗が出ない角度に固定する**方針にした:
  - **ぐるぐる回さない**。前寄りの斜め45度で止め、±8度ゆっくり揺らすだけ
  - **ドラッグで回せる**ようにして逃げ道は残す（見たい人は見られる）
- 質感の底上げ:
  - **接地影**（足元の柔らかい円）を敷いた。浮いていると玩具に見える
  - **ACES トーンマッピング**を有効化。既定だと明るい面が白飛びして「粘土」に見えていた
- **夜のライト表現は将来やれる**と設計書に記録（§14）: モデルに手を入れず、
  three.js はスプライト、Mapbox は発光する点レイヤーを**バウンディングボックスから算出した位置**に置く。
  地図は既に時間帯で lightPreset を切り替えているので、夜だけ出せばよい
- 検証: web tsc クリーン・next build 成功

## 2026-08-11 00:55 夜のライトを実装（地図＋車両プレビュー）

- **地図**: `vehicle-lights` レイヤー（glow + core の circle 2枚）を追加。
  **夜（JST 17〜5時）かつ稼働中の車両だけ**灯す。履歴表示中は出さない
  - **演出で終わらせない設計にした**: 光っている＝まだ外に出ている車。
    夜の地図で「誰がまだ帰っていないか」が一目で分かる情報になる
- **車両プレビュー（three.js）**: 車体の前後端4隅に発光スプライトを配置。
  位置は**バウンディングボックスから算出**するので車種ごとの調整が不要。
  夜は環境光を落とし、露出も下げて灯りを際立たせる
  - **どちらが前かは生成モデルから判定できない**ため、両端とも電球色にした
    （赤いテールランプを前に付ける方が事故なので、確実な側に倒す）
  - 夜かどうかは日本時間で判定（地図の lightPreset と同じ考え方）。props で上書きも可能
- モデルには一切手を入れていない。**glb を作り直さずに夜の表現ができた**
- 検証: web tsc クリーン・テスト 439 passed・next build 成功

## 2026-08-11 01:00 本番ビルドが遅い原因＝生の3Dモデルを git に入れていた

- 症状: 本番（nippo-ace）のビルドが5分以上終わらない。ログを見ると
  **`Cloning completed: 5:56`**＝ビルドではなく **git clone に6分**かかっていた
- 原因: **Meshy から落とした生の glb を git に入れていた**。`.git` が **258MB** に膨張:
  - エブリイ texture **88.2MB** / クリッパー texture **78.6MB** / クリッパー generate **34.2MB** /
    アクティ texture 7.5MB（＋整形のたびに models/*.glb の新しい blob が積み増し）
  - **Vercel は毎回クローンする**ので、以後すべてのデプロイが6分増しになる（dev も本番も）
- 対処（第1段階・非破壊）: `apps/web/public/glb/` を **.gitignore に追加し追跡から外した**。
  生ファイルは `~/Developer/assets/hakotora-3d/` へ退避。**実行時に必要なのは整形後の
  `apps/web/public/models/*.glb`（合計2.6MB）だけ**なので、これは残す
- **残（要判断）**: 履歴からの完全削除。これをしないとクローンは速くならない。
  `git filter-repo` 等で `apps/web/public/glb/**` を履歴ごと削除 → **main への force push** が必要。
  影響: 過去のコミットハッシュが変わる。単独開発なので実害は小さいが、ユーザー判断を待つ
- 教訓: **バイナリを git に入れる前に「実行時に要るか」を問う**。
  生成物の中間ファイルはリポジトリの外に置く

## 2026-08-11 01:10 車種選択を2段セレクトに／モデルの未使用テクスチャを削除

- **車種選択を縦長のチップから「メーカー → 車種」の2段セレクトに変更**（ユーザー指摘）。
  メーカーを選ぶとその車種だけが出る。「その他（自由入力）」もセレクトの選択肢に入れた。
  型式も「選択＋直接入力」の2列に整理。車種が増えても縦に伸びない
- **モデルの未使用テクスチャを削除**: マテリアルから外しただけでは glb に残っていた
  （metallic_roughness / normal の2枚）。明示的に破棄するようにして
  every 787→686KB / clipper 1175→1058KB / acty 620→551KB
- **地図に車両モデルが出ない件は未解決**。配信物は正常（PNG 1枚・1プリミティブ・uint16）で
  three.js では描画できている。Mapbox の model レイヤー側の問題と見て、次はブラウザの
  コンソール（`Could not load model …`）を確認する必要がある
- 検証: web tsc クリーン・テスト 439 passed・next build 成功

## 2026-08-11 01:20 目指す質感の確認と、方針の転換（車種ごと→様式化1体へ）

- ユーザーから目標画像（Google マップの車両アイコン選択画面）を受領。目指すのは
  **様式化されたおもちゃ的な造形／平らな面／窓は1本の暗い帯／単純な黒い円盤のタイヤ／
  柔らかい光／足元の楕円リング**
- **差はレンダリングではなくモデルそのもの**と結論。Google のモデルは低ポリの手作りで
  **面が意図的に平ら**。こちらは写真起こしで**表面が波打っている**ため、
  トゥーンや輪郭線を足しても波打ちは消えない
- **方針転換を提案・記録（設計 §15）**: **車種ごとの再現をやめ、様式化した「軽バン」1体に集約する**
  - Google も車種別モデルは持っていない（体型別）。軽バンはどれも似た箱型で、
    **クリッパーはエブリイの OEM＝実車が同一**。車種ごとの作り分けはこの縮尺で意味を持たない
  - 車種の違いは**ナンバープレートの吹き出し**が担う（実装済み・こちらの方が確実に読める）
  - Meshy 由来のモデルは暫定として残し、良い1体ができたら差し替える
- レンダリング側（トゥーン階調・輪郭線・楕円リング）は**モデルが揃ってから**着手する。
  今やっても波打ちが目立つだけ

### 補足（2026-08-11 01:25）: 3Dモデルの残課題と着手順

判断待ち・作業待ちを整理する（今夜の議論の帰結）。

1. **様式化した軽バン1体の調達**（最優先）— 手作りの低ポリ or CC0 素材集（Kenney / Quaternius）の流用。
   形は「角を丸めた箱」。これが入るまでレンダリング側の作り込みはしない
2. **地図に車両モデルが出ない件**（未解決）— 配信物は正常（PNG1枚・1プリミティブ・uint16）で
   three.js では描画できている。**ブラウザのコンソールに `Could not load model …` が出るかどうか**で
   原因の切り分けが変わる。ユーザーの確認待ち
3. **git 履歴からの生 glb 削除**（要判断）— 現状クローンに6分。`git filter-repo` + main への
   force push が必要。バックアップブランチを取ってから実行する
4. **本番DBへの migration 適用確認** — 124（拠点の範囲）/125（配達エリア）/126（駐車区画）/
   127（色パレット）/128（型式）。未適用の機能は画面に出ても保存できない

## 2026-08-11 01:35 地図に車両が出ない原因を特定・修正（頂点のインターリーブ）

- ユーザーのコンソールログで確定: **3モデルとも `Could not load model … RangeError: offset is
  out of bounds（Float32Array.set）`**。ファイル自体は three.js で描画できていたので、
  Mapbox 側のローダーの制約と判断し、**動いている truck.glb と構造を突き合わせた**
- **真因: 頂点属性のインターリーブ**。
  - こちら: 1つの bufferView に POSITION/NORMAL/TEXCOORD_0 を **stride=32 で交互配置**
  - truck.glb: **属性ごとに別 bufferView**（stride 12/12/8）
  - Mapbox の model ローダーはインターリーブを想定しておらず、詰めて読もうとして範囲外になる
- 修正: `NodeIO.setVertexLayout(VertexLayout.SEPARATE)` を指定。3モデルとも
  stride 12/12/8 の非インターリーブになり、truck.glb と同じ構造に揃った
- **教訓（2回目）**: ローダーの許容範囲は仕様書ではなく**動いている実物**が語る。
  今回も truck.glb との差分を並べた瞬間に原因が見えた
- **方針の訂正を記録**: ユーザーより「エブリイとアトレーは現場では全く別物」。
  車種別の作り分けは現場感覚として効くため、**1体集約は当面の段取り**であり、
  車種別をやらない判断ではないと設計書に明記した
- 検証: 3モデルのバッファ構造を確認（非インターリーブ）。実機での描画確認はデプロイ後

### 補足（2026-08-11 01:40）: 明日の3Dモデル作業への申し送り

- **既存素材の流用から入る**方針でユーザーと合意（Meshy 由来を磨くより、様式化された低ポリを土台に）。
  CC0 の候補: Kenney / Quaternius。改変自由
- **順序の理由**: 様式化の型を1体で固めてから車種を作り分けると、同じ型・同じトポロジーで揃うので
  **エブリイとアトレーの違いが「意味のある違い」として見える**。
  いま車種ごとに質感がばらついた状態で作り分けても、違いが「モデルの出来の差」に埋もれる
- **モデルを差し替えるときの必須条件**（今日ハマった点。`prepare-vehicle-glb.mjs` が全部やる）:
  1. **頂点属性をインターリーブしない**（Mapbox の model ローダーが読めない）
  2. uint16 インデックス／プリミティブ間でアクセサを共有しない
  3. 原点=底面中心・実寸（全長3.4m）
  4. Draco 圧縮を使わない
  5. 車体は無彩色（`body_color` で着色するため）

## 2026-08-11 01:45 生の3Dモデルを git 履歴から完全削除（.git 258MB → 66MB）

- ユーザー承認のもと `git filter-repo` で `apps/web/public/glb/**` を**履歴ごと削除**
- **事前バックアップ**: `git bundle create ~/hakotora-backup-20260811-0129.bundle --all`（220MB）＋
  タグ `backup/before-glb-purge-20260811`。生ファイル自体は `~/Developer/assets/hakotora-3d/` に退避済み
- 結果: **`.git` 258MB → 66MB**。100MB近い blob（エブリイ88MB・クリッパー79MB・34MB）が消え、
  残る大物は既存の `sample/_`（38.7MB）と `juken_certificate.png`（5.8MB）のみ
  → **Vercel のクローン6分は解消される見込み**（デプロイのたびに効く）
- 実行時に必要な `apps/web/public/models/*.glb`（4体・合計2.4MB）は**そのまま残っている**ことを確認。
  tsc も通過
- **未完了: `git push --force origin main`**（権限で拒否）。ユーザー実行待ち。
  filter-repo は安全のため origin を外すので、再設定済み（https://github.com/TTH15/nippo.git）
- 注意: 履歴書き換えのためコミットハッシュが全て変わる。他のクローンがあれば取り直しが必要

## 2026-08-12 「仕事」の統合モデルを設計（docs/design/work-model.md 新規）

- 発端: シフトとは別に単発案件と「その日だけ来る人」を軽く記録したい。ただし単発を別世界にせず
  継続のシフトの仕事とバランスよく統合したい（ユーザー要望）
- 用語整理: **案件**（継続=courses / 単発=spot_jobs 新設）×日付×人=**勤務**、
  打刻の**稼働**（vehicle_sessions）とは明確に区別（「稼働」は予定側に使わない）
- 方針: shifts / シフト表UI / AI取り込みには手を入れない。統合は読みモデル（DayWork 型）で実現。
  使い捨てコース禁止・お金の確定テーブルは作らない（ロードマップH準拠、金額は参考値のみ）
- 決定事項（ユーザー回答）: 同行者は「名前だけ」と「登録メンバー」両対応＋登録項目を設定可能に／
  ライト登録者はアプリで何もできなくてよい／報酬・請求額は数値で持つ（確定しない）
- スキーマ: spot_jobs（org_id NOT NULL FK・title・job_date・集合場所時刻・billing_amount 参考値）＋
  spot_job_members（driver_id or display_name の CHECK、pay_amount）＋ drivers.member_kind='guest'
  （ログインなしのゲスト membership。works_as_driver=false でシフト表には出ない）
- オンボーディング分解: 登録を項目の集合として扱い invites.required_items で招待ごとに必要項目を
  設定（Phase 1 はゲスト直作成のみ、ライト招待・昇格フローは Phase 2）
- 状態: **設計ドラフト。ユーザーレビュー待ち**（実装未着手）

## 2026-08-12 単発案件: 設計承認→Phase 1 実装開始（migration 129 作成）

- 設計 `docs/design/work-model.md` を**承認済み**に更新（用語・Phase 1 スコープともユーザーOK）。
  §8 にユーザー明示の将来方針を2点追記: ①UIは継続（コース）と単発を同格の「仕事」として見せていく
  ②単発の人へ仕事内容（日時・集合場所）を共有する機能（共有リンク/LINE、ライト招待と地続き）
- **migration 129_spot_jobs.sql 新規**: spot_jobs（org_id NOT NULL FK・title・job_date・集合場所/時刻・
  billing_amount 参考値・status planned/done/cancelled）＋ spot_job_members（driver_id or display_name の
  CHECK・pay_amount・vehicle_id）＋ drivers.member_kind（regular/guest、CHECK 制約）。冪等・追加のみ
- **未適用**（他の未適用 migration と同様、apply-migrations の運用に従う。DBには触っていない）
- 次: 管理API（/api/admin/spot-jobs）→ 管理画面（一覧+作成/編集・ゲスト即時作成）→ 日別ビュー並記。
  既存の管理API/画面パターンの調査エージェントが実行中

## 2026-08-12 単発案件 Phase 1 実装（API＋管理画面＋ナビ）

- **API 3本を新設**（capability は設計どおり can_view_shifts / can_manage_shifts に相乗り）:
  - `/api/admin/spot-jobs` GET(月別一覧+参加者ピッカー候補=正規∪ゲスト)・POST(参加者込み作成。
    member insert 失敗時は案件をベストエフォートで巻き戻し)
  - `/api/admin/spot-jobs/[id]` PATCH(部分更新+members 丸ごと置換)・DELETE
  - `/api/admin/spot-jobs/guests` POST(ゲスト作成: role='GUEST'ラベル・member_kind='guest'・
    works_as_driver=false・identity なし=ログイン不可)
  - 共有バリデーション/シリアライズは `src/server/spotJobs.ts`（時刻 HH:MM・金額0〜9999万・
    参加者50人上限・driverId 重複400・他 org の driver 混入チェック）
- **管理画面** `(admin)/admin/(ops)/spot-jobs/page.tsx` + `SpotJobModal.tsx` + `types.ts`:
  月ナビ付きテーブル（日付(曜)/案件名+依頼元/時間/集合場所/参加者/請求参考/状態バッジ）、
  モーダルで DatePicker・TimePicker・CustomSelect を使用。参加者は「メンバー選択」「名前だけ」の
  2種の行 + モーダル内ゲスト即時登録（作成→選択済み行として追加）
- **ナビ**: AdminLayout の navItems にシフト直下「単発案件」(faBriefcase・β・cap=can_view_shifts)
- **検証**: tsc ✅ / vitest 439件 ✅ / next build ✅（4ルート生成確認）/ check:tenant は
  既存警告7件のみ（main と同数＝今回の追加分は警告ゼロ。spot_jobs は migration から自動で検査対象化）
- **残**: migration 129 未適用（dev用 SUPABASE_DB_URL 復旧待ち。適用まで画面はDBエラーになる）。
  Phase 1-4 の日別ビュー並記・DayWork 読みモデルは未着手。Phase 2（ライト招待・ゲスト昇格・
  仕事内容共有・地図ゴーストピン・打刻接続）は work-model.md §5,§8 参照

## 2026-08-13 7月チーム戦レポート作成（アーティファクト・コード変更なし）

- 7月チーム戦（3チーム6名・杉本→日笠交代）を本番DBから読み取り専用で再集計し、6月版と同形式のレポートを公開:
  https://claude.ai/code/artifact/a84addba-abdf-444d-b532-f206e2b6daf6
- 結果: アクザラン優勝 9,622pt（配完3位だが日笠への日当補填+2,900がチーム合計に算入され逆転）。
  2位壬生マスター 9,138 / 3位中久世×上京 9,053（配完首位もペナルティ3件で沈む、85pt差）
- 6月比: 総配完 26,191→25,313、インシデント 10件→4件（0.38→0.16件/千個）に半減。連携評価ボーナスの運用は7月なし
- 集計は `src/scripts/` の既存流儀（dotenv+SELECTのみ）の一時スクリプトで実施し、6月値の再現一致で検算後に削除。リポジトリへの変更なし
- 気づき: 日笠の日当補填が7/22・7/28分だけ未登録（要運営確認）。7月イベントは未クローズ（active）のまま

## 2026-08-13 7月チーム戦レポート改訂＋文書基盤リサーチ用プロンプト

- レポート改訂(同一URL): 個人名記載なしの案件2件(7/5・7/16)は勝政の誤配と運営確認で判明 →
  個人別案件表・分析メモ・加点ログ注記に反映(7月の4件はすべて誤配。勝政2・木下1・坂田1)
- 印刷時にドーナツグラフがページを跨ぐ問題を修正: Chrome では flex コンテナ自身に
  break-inside: avoid が効かないため、印刷時は .donut-panel をブロック化+旧式 page-break-* 併記+
  .scrollx の overflow を visible に
- `docs/prompts/document-editor-research.md` 新規: Tiptap/Lexical 等の比較・ページネーション・
  PDF戦略・工数概算を外部AIに聞くための貼り付け用プロンプト(自己完結型)

## 2026-08-13 7月チーム戦レポートのA4 PDF生成（改ページ問題の根治）

- claude.ai のホストページから印刷すると iframe 内容が機械的にスライスされ、アーティファクト側の
  break-inside CSS では制御不能と判明（印刷フッターの ?via=auto_preview で確認）
- 対処: ローカルHTMLからヘッドレスChromeで直接PDF生成 →
  `~/Desktop/7月チーム戦_結果レポート.pdf`（A4・6ページ・改ページ崩れなしを目視検証済み）
- 微調整: バーラベル列幅 96→110px（「壬生マスター」の折返し解消）、印刷時は加点ログの
  折りたたみ(details)を非表示。アーティファクトにも反映

## 2026-08-13 文書プラットフォームの決定記録

- `docs/design/document-platform.md` 新規: Docs-lite は作らず「テンプレ+差し込み+最小限の
  自由記述欄」路線に決定(ユーザー承認)。正本=構造化データ、A4/PDF はエクスポート形式に降格
- 契約書をこの路線でハコ虎上で作成できるように進めることも決定(§3 にたたき台モデル:
  contract_templates / contract_documents / 同意ログ。スコープは着手時に別途)

## 2026-08-13 単発案件: シフト画面への表示に着手（API に期間指定を追加）

- ユーザー合意: 単発案件はシフト画面にも表示する（「継続と単発を同格に見せる」方針の実行）。
  あわせて、セル編集ポップオーバーの「＋コース」チップが平坦で探しづらい問題の改善も要望
  （スクショ確認済み: コース未割当時にチップ11個が無秩序に並ぶ）
- `GET /api/admin/spot-jobs` に `?start=YYYY-MM-DD&end=YYYY-MM-DD` を追加（month と排他。
  シフト画面の表示期間に合わせて引くため）。tsc ✅
- 進行中: シフト画面（3552行）の構造調査エージェント実行中。表示の組み込みとチップ並び順改善は次エントリで

## 2026-08-14 単発案件のシフト画面表示・コースチップ改善・ナンバープレートSVG化

### (1) 単発案件をシフト画面に表示（work-model §4 の読み込み側・Phase 1-4）
- シフト画面が `/api/admin/spot-jobs?start=&end=` を表示期間で並行取得（migration 未適用でも画面は無事）
- **PCドライバー軸**: 参加ドライバーのセルに sky トーンのチップ（希望休 amber と別系統）。
  グリッド末尾に「単発案件」行（全件・ゲスト含む。タップで一覧へ）
- **スマホ日別ビュー**: リスト上部に単発案件セクション（案件名・集合時刻・人数）
- **セル編集モーダル**: そのドライバーの単発案件を読み取り専用で表示（一覧へのリンク）
- タブ件数（全員/稼働/未割当）は従来のコース割当のみ＝未変更（要検討として残す）

### (2) 「＋コース」チップの並び順改善（探さないといけない問題）
- `/api/admin/shifts` GET に `recent_assignments`（期間前35日の driver×course×date）を追加
- `getAddableCoursesForDriverOnDate` のソートを「頻度→直近使用日→sort_order」に変更
  （期間内 shifts + 直近35日実績から集計。セル編集モーダル・未割当モーダル両方に効く）
- セル編集モーダルは「最近入ったコース / その他」の2グループ表示（片方だけなら従来どおり）

### (3) ナンバープレートの文字を SVG グリフ化（public/number_plate）
- `src/scripts/generate-plate-glyphs.ts` 新規: SVG（283.4646四方キャンバス）から bbox を算出し
  `src/lib/plateGlyphs.generated.ts` を生成。パスパーサ（ベジェ10分割サンプリング・transform対応）
  - 地雷1: 数値正規表現が「-.79.0002」を1数値に貪欲マッチ→分岐で修正
  - 地雷2: 練・大の SVG に**トレース残骸の白シェイプ**（fill="#fdfcfc"等）が混入→明色 fill を除外
- `VehiclePlate` を SVG グリフ描画に切替（CSS mask + #e8d44d 塗り）:
  - 漢字・かな・分類=グリフ単体を行高に正規化 / シリアル=数字基準のカテゴリ縮尺（・と-の実寸比を維持）
  - **等ピッチ**（幅の細い1も1桁分のスロット。実物準拠）、3桁以上はハイフン表示（・1-23）
  - グリフ未収録（分類2/7・り/れ以外のかな・収録外地名）は**セグメント単位でフォントにフォールバック**
- `/preview/plate` 新規（認証不要）: 標準/compact×8サンプル。Chrome 実機で目視確認済み
- 検証: tsc / vitest 439 / next build すべて ✅。素材追加時は generate-plate-glyphs を再実行
