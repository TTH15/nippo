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
