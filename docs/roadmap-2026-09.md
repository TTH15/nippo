# 作業洗い出し 2026-09（AI作業の加速 × セキュリティ精査の裏取り）

2026-09-06 作成。2本の ChatGPT スレッド（認証不要プレビューの設計論、Codex によるセキュリティ精査の要約）を hakotora の実コードに照らして整理した。未完タスクの従来の正本は `docs/roadmap-2026-07.md`。ここは「これから着手する順番」を決めるための一覧で、各項目は着手時に設計文書へ昇格させる。

精査レポート本体（`HakoTora-Security-Review-2026-09-05.md`）はリポジトリに保存されていない。**最初に Codex 側から取り出して `docs/security/` に置く**（根拠・再現手順を失わないため）。

## 判断: 認証バイパスの本番モードは作らない

ChatGPT 案の `PREVIEW_AUTH_BYPASS=true` は採用しない。hakotora は dev Supabase を持たず、ローカルも本番 DB 直結（`.env.local`）のため、認証を抜いた同一アプリを立てると「認証なし → 本番 DB」の経路そのものになる。代わりに既存の隔離 runner（esbuild で本番ページを束ね、API・認証・Router だけを fixture に差し替え、CSP で外部送信を遮断）を、ChatGPT 案の要点である **同一コード・fixture・シナリオURL・役割URL** で拡張した（2026-09-06 実装済み・`docs/development/preview-workflow.md`）。

## A. プレビュー基盤（AIのコード→ブラウザ→修正ループを速くする）

| # | 作業 | 目的・内容 | 規模 |
|---|------|-----------|------|
| A-1 | fixture の追加（シフト／報告／売上／請求書／記録） | 改修頻度の高い画面を `/preview/admin/<slug>` で開けるようにする。シフトは既存の `scripts/previews/shifts-services.tsx` を fixture 形式へ移し、`-- shifts` をエイリアス化 | 中 |
| A-2 | 日付依存ページの固定 | `todayJST` を読むページ（ダッシュボード・日報）が日によって見た目が変わる。`?date=` で「今日」を固定できるよう `@/lib/date` を runner で差し替える | 小 |
| A-3 | 全シナリオ巡回の手順化 | 一覧の全リンク（ページ×シナリオ×役割）をアプリ内ブラウザで順に開き、崩れ・console エラーを拾う手順を `preview-workflow.md` に固定。ui-auditor サブエージェントの入力にする | 小 |
| A-4 ✅ 2026-09-06 | 本番側の崩れ修正（プレビューで発見） | 車両カードの長い車種名がカード右端を突き抜ける（`/preview/admin/vehicles?scenario=long-name`）。ui-ux-pro-max の指針（省略せず折り返す）で修正済み | 小 |
| A-7 ✅ 2026-09-07 | 地図の3車種取り込みと夜のヘッドライト | keivan-3d のハイゼット19／エブリイ88／アクティ75 を `finish-glb-for-mapbox` → 3分割（車体・固定色・灯火）で `VEHICLE_MAP_MODELS` に登録し、`model_key` を車種単位で接続（型式は扱わない）。灯火層は夜（17〜5時）だけ発光させ、稼働中の車のヘッドライト・テールランプを地図上で点ける（2026-09-06 ユーザー要望）。材質名が HH5 規約と一致するかを先に確認 | 中 |
| A-5 | Next の `/preview/*` 一覧との統合 | `apps/web/src/app/preview/page.tsx` から runner の起動方法と URL 規約へ誘導する（ポートが違うため直リンクは不可） | 小 |
| A-6 | fixture の再利用 | `fixtures/users.ts` の架空ドライバー・コースを他ページの fixture からも使い、画面間で同じ人物・車両が出るようにする | 小 |

## B. セキュリティ（Codex 精査の裏取り → 修正）

精査の主張をコードで確認した結果を「裏取り」に記す。修正順は「DB公開権限 → 共通認可・失効 → 他社更新／ファイル参照 → 管理画面のHTML描画 → PIN・Passkey」で、精査の提案と一致する。**金額・認証に触る変更は、影響ユーザーと戻し手順を先に書いてから着手する。**

| # | 指摘 | 裏取り（2026-09-06） | 起こり得る実害 | 作業 |
|---|------|----------------------|----------------|------|
| B-1 ★最優先 | anon key を配る経路に対し DB 権限・RLS が不十分 | `api/admin/map/share-session/route.ts` が `SUPABASE_ANON_KEY` を返す設計（地図共有ビュー Stage1）。RLS は全 migration で未使用。`REVOKE ... FROM anon, authenticated` は migration 154〜157 の新規テーブル・関数だけ | anon key と URL を知る誰でも、Supabase 既定の権限が残る全テーブルへ REST で直接アクセスできる可能性（全社データ） | 1) 本番 DB で `information_schema.role_table_grants` を anon／authenticated で棚卸し 2) `REVOKE ALL ON ALL TABLES/FUNCTIONS IN SCHEMA public FROM anon, authenticated` ＋ `ALTER DEFAULT PRIVILEGES` の migration 3) 共有ビューは anon 直読みをやめ、サーバー経由の署名付きスナップショット or 専用 RPC（SECURITY DEFINER で org・期限を検査）に変更 4) `SUPABASE_ANON_KEY` の本番設定有無を確認（未設定なら 3 まで設定しない） |
| B-2 | 停止・削除済み利用者を共通権限チェックが通す／承認待ちユーザーが業務APIを使える | `requireAuth`（`src/server/auth/index.ts`）は `authProvider.verify` の JWT 検証のみで、membership の status／削除を DB 照合していない。capability は発行時点の束 | 退職者・削除済み ADMIN・盗難トークンが期限まで有効。承認待ち（PENDING）が自社データ取得や出勤記録作成に到達し得る | 1) `verify` 後に membership を軽量照合（status∈{active}, deleted_at IS NULL, org 一致）。短 TTL キャッシュ可 2) 停止・削除・ロール変更時にトークン世代（`token_version`）を上げて旧 JWT を失効 3) PENDING は `/api/join/*` と本人プロフィール以外を 403 4) 影響: 全ユーザーの再ログインは不要にする（世代は変更時だけ上げる） |
| B-3 | 他社報告の承認・却下で関連データ（車両走行距離・経費）を変更できる | `daily/approve`・`daily/reject` は `resolveOrgId` で org を絞っている（精査の主張とは異なる）。ただし approve 内の車両更新は `.eq("id", vehicleId)` のみ（report 行由来なら安全）。**報告種別（misc-reports／report-kinds）の承認経路は未確認** | 他社の報告 ID を知る運営が、他社車両の走行距離や経費を書き換える | 1) `npm run check:tenant`（既存の静的検査）を全 admin ルートに拡張し、id 指定 UPDATE／DELETE に org 条件が無い箇所を列挙 2) misc-reports／report-kinds／attendance の承認・却下を org 付き UPDATE に統一 3) itest で他社 ID を投げて 404 になることを固定 |
| B-4 | 他社 Storage パスを受け入れて署名する | `createSignedUrl` は `server/kyc/storage.ts`・`vehicleQr/*Storage.ts`・`reportKinds/attachments.ts`・`storage/dataUrl.ts` の5箇所。パスの org 接頭辞を強制しているかは未確認 | 他社ファイルのパスを知る利用者が、自社請求書経由で非公開添付の閲覧URLを作らせる | 各署名関数に「`<org_id>/` 接頭辞の一致」をサーバーで強制し、DB の添付行から path を引く（クライアントの path をそのまま使わない） |
| B-5 | ドライバーの住所が請求書で HTML として描画される | `InvoiceSheet.tsx` が `toAddrHtml`／`fromAddrHtml` を `dangerouslySetInnerHTML` で描画。`addrHtml()`（`editorModel.ts:545`）は `〒${p}<br/>${a}` の連結で**エスケープしていない** | 細工した住所（会社設定・ドライバー編集から入る）を管理者がプレビューするとスクリプト実行。本番 CSP の有無で実害の大きさが変わる | 1) `addrHtml` を廃止し、住所は文字列＋`whitespace-pre-line` で描画（`<br/>` は改行へ変換） 2) 既存保存データ（`toAddrHtml` に HTML が入っている）を移行時にタグ除去 3) `next.config` の CSP に `script-src 'self'` を入れる（PDF 生成への影響を確認） |
| B-6 | PIN 廃止を API が保証していない／初期 PIN がコード末尾 | `api/auth/login` は `pin_hash` があれば通す。`admin/users`・`admin/users/[id]`・`reports/profile` が `pin_hash` を発行・変更できる | PIN 未設定の利用者が後から PIN を作って PIN ログインでき、推測可能な初期 PIN が残る | 精査の順番どおり: 1) 既存ユーザーの電話認証・Passkey 状況を管理画面で可視化（`users` の `phone_verified_at`／`has_passkey` は既にある） 2) mobile を SMS OTP／ネイティブ Passkey へ 3) Web ログイン画面からコード＋PIN 欄を外す 4) `login` の driver PIN 経路と PIN 発行 API を閉じる 5) `pin_hash` を無効化。旧 Vercel URL は hakotora.jp へリダイレクト |
| B-7 | Passkey: 認証応答の再利用（counter=0）／盗んだセッションから Passkey 登録 | `webauthn/login/verify` は `counter` を保存・更新している。チャレンジの一回限り消費と 5 分の有効期限の実装は未確認。登録 API が直近の強い本人確認を要求しているかも未確認 | 有効期限内に完全な認証応答を入手されると 2 回ログインできる。一時的な乗っ取りを恒久化される | 1) チャレンジを使用時に削除（`DELETE ... RETURNING` で原子的に） 2) counter=0 同士は許容しつつ、同一チャレンジの再提出を拒否 3) Passkey 追加・削除は直近 5 分以内の SMS OTP or Passkey 再認証を要求 4) 新規登録を通知（LINE／SMS） |
| B-8 | Next.js の画像処理アドバイザリ | `next ^16.2.0`。該当バージョンと修正版は要確認 | 細工画像が最適化処理へ届いた場合の DoS／メモリ破壊 | `npm audit` と Next 公式告知の突合 → パッチ版へ更新（`vercel:next-upgrade` スキル） |

## C. 既存の未完（参照のみ）

- migration 135（チャット集計）・152（単価再構築）・157（車両移動）が未適用。157 は SQL Editor で再実行待ち
- 地図の車両移動・空中アーチ（未コミット差分あり）。`git status` の `map/` 系はこの作業のもの
- 認可の own 化（本人系ルート約 33〜41 本が `requireAuth` のみ）。B-2 と同時に進めると効率がよい

## 進め方の提案

1. **今週**: B-1 の棚卸し（読むだけ・書き込みなし）と精査レポートの保存。A-4 は 30 分で終わるので同日に
2. **次**: B-2（照合＋失効）→ B-3（check:tenant 拡張）。両方とも itest を先に書く
3. **その後**: B-5・B-4 → B-6（利用者影響があるので告知とセット）→ B-7
4. A-1〜A-3 は上記の合間に。改修する画面の fixture を「その画面に触る直前」に作るのが最も無駄がない
