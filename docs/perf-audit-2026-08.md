# 通信・更新まわり全画面監査（2026-08-14）

次セッションはこのドキュメントから着手する（ユーザー指示: 「次のセッションでその全面修正から入ります」）。
§1 は 2026-08-14 に実施済みの修正＝**修正の参照パターン集**。§2 が全画面の調査結果、§3 が着手順。

## §1. 適用済みパターン（今日の修正。以降の画面はこれらを移植する）

いずれも apps/web。すべて実装済み・検証済み（tsc / vitest 444 / next build）・**未コミット**。

### P1. 差分PUT（users で実装）
モーダルを開いた時点のフォーム値を `baselineRef` に記録し、変わった項目だけ送る。
サーバーが「undefined の項目は変更しない」部分更新仕様であることを確認してから使う
（users の PUT はもともとその仕様だったため API 改修不要だった）。
重いセクション（identities の upsert・リース等）は「そのセクションの項目が変わった時だけ」丸ごと送る。
実装: `src/app/(admin)/admin/(resource)/users/page.tsx` の `baselineRef` / `save()`。

### P2. 保存の並列化＋即時反映（users で実装）
複数の保存リクエストは配列 `jobs` に集めて `Promise.all`。一覧の楽観更新（setState）は
サーバー完了を**待たずに**行う。従属しない片方の失敗を握りつぶすかは従来挙動に合わせる。

### P3. saveInflight ガード＋遅延 refetch（shifts の autoSavingRef / users の saveInflightRef）
「保存直後の refetch が『保存前のサーバー状態』を持ち帰り、SWR 同期エフェクトが楽観更新を
上書き→変更が巻き戻る」競合の対策。
- 実行中カウント ref（インクリメント/finally でデクリメント）
- SWR→state の同期エフェクトは実行中ならスキップ
- 保存後の refetch は即時 `mutate()` せず、1.5s 遅延タイマー＋実行中なら再延期（落ち着いてから1回）
実装: users/page.tsx `saveInflightRef` `scheduleUsersRefetch`、shifts/page.tsx `autoSavingRef`。

### P4. 一覧と重い集計の分離（vehicles で実装）
一覧APIは軽い列だけ即返し、履歴走査を伴う集計は別エンドポイントに分離、画面は後追いで
流し込む（後追い中は「計算中…」表示。0 と誤読させない）。
実装: `/api/admin/vehicles` と `/api/admin/vehicles/recovery`、vehicles/page.tsx の `recoveryData` マージ。

### P5. 集計のSQL化＋フォールバック（migration 131・未適用）
アプリ側で全行転送して集計している箇所は Postgres の GROUP BY 関数に置き換え、
RPC 失敗（migration 未適用）時は従来のアプリ側走査へフォールバック。
実装: `supabase/migrations/131_vehicle_daily_lease_agg.sql`、`src/server/billing/vehicleRecovery.ts`。
※ 131 は SUPABASE_DB_URL 復旧後に 118/119/129/130 と一緒に適用。

### P6. 署名URLのバッチ発行（共通ヘルパーで実装）
`createSignedUrl` を1件ずつ呼ばず `createSignedUrls` で一括（PDF=download 指定は別グループ）。
実装: `src/server/storage/dataUrl.ts` `resolveStoredUrls`（全呼び出し元に効く）。

### P7. カーソルページング＋自動追い読み（users 既存 / vehicles で移植）
一覧APIに `?limit=&cursor=`（未指定は従来どおり全件＝既存利用の互換維持）。ORDER BY に
id タイブレーク必須。画面は useSWRInfinite で上から順に取得し、`hasMore` の間は自動で
次ページを読む（1ページ目が届いた時点で描画開始）。
実装: `/api/admin/vehicles` GET、vehicles/page.tsx。

### P8. hover intent 先読み（users で実装）
一覧の行に 120ms hover したら詳細を裏取得してキャッシュ（通過では撃たない）。スマホは
touchstart で即発火。inflight Set で重複防止。保存後はキャッシュを delete せず保存内容で更新。
実装: users/page.tsx `prefetchDetail` / `onRowHoverStart`。

### P9. 隣接データの preload（shifts で実装）
期間ナビのある画面で、現期間の取得完了後に前後期間のAPIを `preload`（SWR）で裏取得。
境界越え（スワイプ/ステッパー）でスケルトンを出さない。prefetched Set で重複防止。
実装: shifts/page.tsx の preload effect、`adjacentHalf`/`halfDates`。

### 判断基準（先読み・キャッシュ関連）
- 先読みは「本数が少なく当たる確率が高い」場面のみ（隣接期間=2本×高確率は○、
  一覧全行の詳細=N本×低確率は×→hover intent にする）
- Vercel/Supabase とも今回程度のリクエスト増は課金影響なし（Supabase はクエリ課金なし・
  転送量制、Vercel は無料枠/Pro込み枠）。ダッシュボードの Usage で月1確認すれば十分

## §2. 全画面調査の結果（2026-08-14 実施）

パスは apps/web/ 起点。sev=高は §3 の着手順に反映。

### §2.0 横断（共有基盤）

- **高** `src/server/aggregation/load.ts:43-62` carriers/units/unit_fields/course_unit_rates/course_fixed_rates が fetchAllRows を通らない素SELECT。**1000行超で単価が黙って欠落＝過少請求/過少支払** → fetchAllRows+一意ORDER BY
- **高** `src/lib/components/AdminLayout.tsx:125-140` 全管理ページで60秒ポーリング5本。うち `api/admin/daily/unread-count/route.ts:21-26,51-61` は **2020年〜の shifts 全件+日報全件を毎分走査**（どの画面でも） → カウント専用の軽量集計に分離+`/api/admin/badges` 統合+間隔見直し
- 中 `src/lib/components/Providers.tsx:19-23` グローバルで revalidateOnFocus が SWR 既定ON。重い集計ページ（payments/invoices/counterparties）がフォーカス復帰のたび再集計+setState上書き → 各ページで false 指定（sales は済）
- 中 `src/server/aggregation/reportContent.ts:41-53` 200件バッチが for+await 直列（legacyShape.ts:205-217 は並列化済み） → Promise.all
- **セキュリティ（性能とは別枠・最優先確認）**: `api/admin/daily/reports/[id]/route.ts:50-56` PUT に org_id スコープなし／`api/admin/events/[id]/route.ts:33-34`・`api/admin/events/[id]/ranking/route.ts:28-32` の events SELECT に org_id 条件なし（ID直指定で他社データに到達しうる）

### §2.1 経理・分析（payments / invoices / adjustments / counterparties / sales）

#### payments
現状: 一覧SWR→setRows転写。行展開ごとに driver-rewards 個別fetch（自前キャッシュ）。保存は POST群→再取得2本→loadPayments。
- **高** `payments/page.tsx:194-221` + `src/server/billing/driverPayout.ts:63` 行展開ごとに driver-rewards＝**org全体の月次日報集計を毎回実行**（20人展開=全社集計20回） → 一括バッチAPI or 一覧に明細同梱（P4集計分離）+SWR化
- **高** `api/admin/payments/route.ts:63-133` 独立クエリ5本が全部直列 await → P2並列化
- **高** `payments/page.tsx:279-314` 請求書作成の3連続 await（相互依存なし） → Promise.all
- 中 採番のため月の請求書一覧を丸ごと取得（サーバに resolveUniqueInvoiceNo あり）／保存・削除の直列待ち＋楽観更新なし／モーダルと展開行で同じ集計を二重取得／revalidateOnFocus 未対策
- 低 展開の hover 先読み余地

#### invoices
現状: 一覧SWR（全期間・月指定なし）→setInvoices転写。スターは350msデバウンスPATCH。編集は自動保存（inflightガードは正解形）。
- **高** `api/admin/invoices/route.ts:145-158` + `invoices/page.tsx:219` 一覧GETに limit/range なし＝**1000件超で古い月フォルダが静かに消える** → month 必須化+P7ページング、年月フォルダは distinct 集計に分離
- **高** `InvoiceSheetEditor.tsx:111-113` `users?limit=500` はサーバで100にクランプ（`api/admin/users/route.ts:19`）＝**請求元セレクトが100件で黙って欠ける**+重い列 → 軽量セレクタAPI
- **高** `invoices/page.tsx:295-353` アップロードを base64 data URL（最大約6.7MBのJSON）で POST（サーバは結局 Storage へ退避） → 署名URL直アップロード+path のみPOST
- **高** `invoices/page.tsx:222-227×355-371×438-445` SWR同期エフェクトが setState を上書き。未flushのスター状態が void load()/フォーカス再検証で巻き戻る → P3ガード+revalidateOnFocus:false
- 中 `invoices/[id]/route.ts:161-199,261-303` PATCH前の追加SELECT最大3回直列（自動保存のたび）→ 並列化+不要時スキップ／全項目PATCH → P1差分
- 中 `editorModel.ts:406-445` **保存bodyに attachments が無く、アップロード済み請求書を編集すると添付が消えるデータ欠落バグ** → パススルー（差分PUTで自然解決）
- 中 `api/admin/invoices/draft/route.ts:317-329` shifts がページングなし+IN句200件超リスク → fetchAllRows+分割
- OK: 一覧SELECTの列絞り・署名URLバッチ・自動保存の inflight ガードは正解形

#### adjustments（閲覧専用）
- 中 `api/admin/sales/log/route.ts:45-58` ページングなし（1000行切り詰め） → P7
- 低 不要列返却／revalidateOnFocus／隣接月 preload 余地

#### counterparties
現状: 全社月次集計サマリをSWR。行展開は useEffect+apiFetch 直書き。手入力行は月まるごとPUT（delete-all→insert-all）。
- **高** `CounterpartyBillingExpand.tsx:95-132` + `computeCounterpartyMonthRevenue.ts:73` 展開のたび SWRなし直fetch＝**取引先1件のために org 全体を集計**。開閉・再訪で毎回 → SWR化+P4集計分離
- **高** 同 `:232` セル1つ blur するたび onRefreshSummary＝**全社サマリ再実行** → 遅延refetch+デバウンス
- **高** `counterpartyBillingSnapshot.ts:138-267` 6連続 await（依存は1箇所のみ） → P2並列化
- 中 手入力行の全件PUT（行IDが毎回変わり摘要ラベルが孤児化）→ 差分upsert／保存後の2本同時refetchが draft を上書き（巻き戻り）→ P3／メモ1行保存で全社集計再実行 → 遅延refetch／revalidateOnFocus 未対策
- 低 サマリAPI内の直列／hover 先読み余地

#### sales
現状: グラフ2本はSWR（設定良好）。それ以外7本が useEffect+apiFetch 直書き。
- **高** `sales/page.tsx:1085-1175` **7本すべてSWRなし**。タブ切替だけで重い再取得 → SWR化（マスタは長dedup）
- **高** `api/admin/sales/reports/route.ts:102-108` shifts が org絞りなし・ページングなし（無言切り詰め→集計が静かに欠落） → fetchAllRows+org境界
- **高** 期間変更で同じ日報+entriesを**4本が別々にフルスキャン** → 集計の統合/共有キャッシュ
- 中 `reports-summary/route.ts:66-78` 200件バッチ直列 → 並列化／ログ保存・削除の全件再取得+重い集計2本 → 楽観更新+遅延refetch／`page.tsx:1157` users が既定20件＝**対象者セレクトに20人しか出ない** → 軽量セレクタ

### §2.2 運行系（attendance / daily / map / notifications / misc-reports / spot-jobs）

#### attendance
現状: useEffect+apiFetch 直書き。日付切替のたび表が空白化。承認は楽観更新（良）。
- **高** `attendance/page.tsx:75-89` SWRなし＝再訪・日付戻しで毎回フルロード → SWR化
- **高** 同 `:76,114-115` setLoading(true) が全描画を消す → keepPreviousData+初回のみスケルトン
- 中 隣接日の preload なし → P9
- 低 保存後の invalidateApi なし

#### daily（日報管理）
現状: pending=全履歴API、all=90日API。SWR→setState転写。全操作後にフル refetch。
- **高** `api/admin/daily/day-summary-range/route.ts:49-52` pending が **2020-01-01〜今日を毎回スキャン** → 「要対応が残る日」の集計分離 or 直近N日+未解決日
- **高** 同 `:140-145,197-200` report_entries を**同一リクエスト内で二重読み**（withEntries:true+loadReportContents） → withEntries:false
- **高** 同 `:255-274` 各日オブジェクトに drivers 全件+preferredVehicle 全件を複製＝ペイロード二次膨張 → トップレベルに1回
- **高** `daily/page.tsx:276-303` 編集保存が PUT→approve→全履歴refetch の完全直列でモーダルブロック → 先にモーダル閉+楽観反映+遅延refetch（PUTに status 同梱で1往復化も）
- **高** 同 `:183-187`+`:220-228` all タブの楽観更新が SWR 同期エフェクトで巻き戻る（承認した行が復活） → **`others/OtherReportsContent.tsx:160-166` の `mutate(updater,{revalidate:false})` パターンを移植**
- 中 却下の楽観更新なし／代理入力後の全履歴refetch／ProxyReportModal の全項目送信+SWRなし+hover先読みなし／`reports/[id]/route.ts:91-105` entries 全削除→全挿入 → 差分upsert／`approve/route.ts:69-91` 車両ごと直列 select→update → 一括化／`report-form/route.ts:36-111` 7段逐次 await → 並列化

#### map
現状: 4本SWR並列+60秒ポーリング。保存は完了→全再取得。
- **高** `map/page.tsx:1833-1841`（キー `:530-541`）履歴スライダーが1段ごとにAPIを叩く＝1ドラッグ最大96リクエスト → 300-400ms デバウンス（`:751-758` の検索と同手法）
- **高** `api/admin/map/vehicles/route.ts:57-62,96-101` 位置2000行+セッション1000行の固定limitスキャン（増えると古い車両が黙って消える）を60秒ごと → `DISTINCT ON (vehicle_id)` の RPC/ビュー化
- 中 ドラッグ配置の楽観更新なし（ピンが一瞬戻る）／区画・エリア保存のレスポンス破棄→全再取得／拠点編集のフルPATCH
- 低 編集モード中のポーリング継続／course-areas ポリゴン常時全件

#### notifications
- **高** `SettingsTab.tsx:64-74` SWR→setState転写+revalidateOnFocus 既定ON＝**トグル変更中にタブ復帰で巻き戻る** → dirtyフラグ+focus無効化
- **高** `page.tsx:33-36`×`ChatTab.tsx:53-56` 同一キーに60秒と30秒の**二重ポーリング** → 親で1本化
- **高** `chats/[driverId]/route.ts:73-79` GET のたびに read_at を UPDATE（15秒ごと書き込み） → 既読は明示POSTへ分離
- 中 スレッド一覧が直近500件固定＝超えると未読数が過小 → DISTINCT ON+count分離／送信の楽観追記なし（POSTレスポンス破棄） → mutate append
- OK: BroadcastTab・QuotaBar・broadcast API は良好

#### misc-reports /others（最も健全。daily 移植のお手本）
- 中 `api/admin/misc-reports/oil-change/route.ts:35-43` ORDER BY が単独列（一意でない）＝ページ間重複・欠落 → id タイブレーク追加
- 中 `server/reportKinds/attachments.ts:57-65` 添付1件ごとの署名URL発行 → P6バッチ化
- 低 select("*")／offsetページング
- OK: `OtherReportsContent.tsx:117-171` タブ別SWR設定・`mutate(updater,{revalidate:false})` 楽観更新は**模範形（daily に移植する正解）**

#### spot-jobs
- 中 PATCH全項目送信（サーバは差分対応済みなのに）→ P1／更新レスポンス破棄→月全体再取得 → mutate反映／ゲスト作成で月全体再取得／隣接月 preload なし → P9
- 低 削除の楽観更新なし／候補リストを月ごとに再送
- OK: 月別SWRキャッシュ・participants 一括取得は良好（courses / carriers / roles / events / submit-screen / ダッシュボード / report-kinds / account）

#### courses（コース管理）
現状: 合成キーで5API並列取得。編集は useAutoSave で全項目PUT+単価PUT直列→5API全再取得。
- **高** `(delivery)/courses/page.tsx:425-470` 自動保存のたび全13項目PUT+単価PUT直列+5API再取得＝計7リクエスト → P1差分PUT+P2並列化+P3遅延refetch
- **高** 同 `:494-499` + `:321-328` closeEditModal が flushAutoSave 直後に persistCourseEdit を再実行→同一PUT×2が並走 → saveInflightRef で実行中は即return
- **高** 同 `:264` → `api/admin/users/route.ts:94-113` `/api/admin/users` をパラメータ無し（既定 limit=20）で使用。**21人以上で担当ドライバー表示・割当候補が欠ける機能バグ**。不要列（住所・口座）+ identity ごとの署名N+1も → `?all=1` か軽量API新設、署名はP6バッチ化
- **高** 同 `:199-222` → `api/admin/courses/route.ts:191-204` 並べ替えPATCHがサーバーでコース数ぶん直列UPDATE → 差分+一括upsert
- 中 保存/作成/削除後の毎回 refreshBundle（5API） → 遅延refetch+レスポンス反映
- 中 `CourseRateEditor.tsx:84-142` useEffect+apiFetch 直書き（SWRなし・開くたび再取得） → SWR化+hover先読み
- 中 `api/admin/courses/[id]/route.ts:169-173` 削除の3直列DELETE（org未指定も） → 並列化+orgスコープ
- 低 合成キーで `/api/admin/carriers` が他画面と dedup されない／`select("*")`／単価の hover 先読みなし

#### carriers（キャリア/報告フォーム設計）
現状: useApi 1本（サーバーで3並列）。全書き込みが await→全木再取得、楽観更新なし。
- 中 `(delivery)/carriers/page.tsx:107-131` 1文字の変更でもキャリア木まるごと再取得。PATCHは更新後行を返すのに未使用 → レスポンスで `mutate(updater,{revalidate:false})`+遅延refetch
- 中 `api/admin/carriers/route.ts:22` `unit_fields` が **org絞り込みなし・ページングなし**（1000行サイレント切り詰めで項目が静かに消える） → `.in("unit_id", unitIds)`
- 低 SWR→useState ミラー／削除前チェック2件の直列

#### roles（ロール・権限）
現状: useSWR 1本。トグル・割当・並べ替えは楽観更新+バックグラウンド書き込み（形は良い）。
- 中 `(resource)/roles/page.tsx:134,158,213` 書き込み成功後に即 mutate()。連打で1発目の refetch が2発目の楽観更新を上書き（users と同型） → P3 saveInflight+遅延refetch
- 中 `api/admin/roles/route.ts:94-106` 並べ替えの直列UPDATEループ → 一括upsert
- 低 capability の全DELETE→全INSERT（トグル1個で総入れ替え）／作成時の await mutate()

#### events（チーム戦）
現状: 一覧+詳細（7並列）+carriers。RankingTab のみ useEffect 直書き。
- **高** `RankingTab.tsx:89-128` SWRなし。タブを戻るたびイベント全期間の日報を再集計 → SWR化（ranking/points の2キー）
- **高** 同 `:194,224` 手動加点のたび silentSync がランキング全再計算+一覧APIを再実行（ローカル反映済みなのに） → points のみ確定、ranking は遅延/明示再計算
- 中 詳細APIとページで**キャリア木を二重ダウンロード** → 詳細APIから carriers を外す
- 中 `EventSettingsTab.tsx:60-70` 保存は5項目フル送信→一覧+詳細（7クエリ）再取得。PATCHレスポンス未使用 → P1+レスポンス反映
- 中 `ScoringRuleTab.tsx:98-102` 採点ルール保存後の詳細フルリロード → 同上
- 中 `api/admin/events/[id]/route.ts:33-40` events SELECT に org_id 条件なし+unit_fields 全件 → **セキュリティ: ID直指定で他社イベントが読める。ranking/route.ts:28-32 も同様**（最優先で修正）
- 低 selectEvent の setDetail(null) で一瞬スケルトン／一覧行の hover 先読みなし

#### submit-screen（送信後画面の設定）
現状: useApi 1本。明示保存で config 全体PUT→全再取得。
- 中 `page.tsx:241-245`+`:181-192` 保存後の void load() が全再取得→同期エフェクトが編集中 blocks を上書き（巻き戻り） → PUTレスポンスで mutate、refetch不要
- 中 楽観更新・自動保存なし（離脱で消える） → useAutoSave+P3
- 中 `api/admin/submit-screen/route.ts:33` unit_fields が org 無関係・全件 → `.in("unit_id",…)`
- 低 eventVisibility 更新の直列ループ（現状未使用）

#### ダッシュボード /admin
現状: 合成キーで6本並列 + AdminLayout が常時5本を60秒ポーリング。
- **高** `page.tsx:78-80` × `AdminLayout.tsx:125-134` バッジ系3本が**重複実行**（合成キーのため dedup が効かない）。`api/admin/daily/unread-count/route.ts:51-82` は 2020年〜今日の shifts 全ページ+日報全期間ロードの重い処理で、表示ごとに2回+60秒ごと → 同一SWRキー共有、さらに **`/api/admin/badges` に件数API統合**（表示時11本→5-6本）
- 中 capability を見ず6本発射（権限の狭いロールは毎回403が4-5本） → 条件付きキー
- 中 「本日の稼働数」に shifts 全行取得→クライアント集計 → 件数API化
- 中 `/api/admin/sales` を月次+14日の2本（どちらも重い集計） → 1リクエスト化 or キャッシュ
- 低 SWR→useState×7 のミラー

#### report-kinds
- 中 `page.tsx:140-152` 保存で全項目送信→全件再取得（PATCHレスポンス未使用） → レスポンス反映
- 低 削除の全件再取得／自動保存なし
- OK GET は軽量マスタ1クエリ

#### account
- OK: 1本の軽量取得のみ。Passkey の2ステップ直列は必然。アンチパターンなし

### §2.4 ドライバー向け（submit / report / shifts / me / rewards / notifications / join / register / ルート）

#### 共通レイヤ
- **高** `src/lib/components/TeamPointsBadge.tsx:25-40` 常設バッジが SWRなし生fetch＝毎ページ遷移で `/api/me/team-status` を再取得。`/me` では `TeamPointsCard.tsx:16-25` と**二重**（両方生fetchで dedup 不発） → useApi 化+長め dedup
- **高** `api/me/team-status/route.ts:66` バッジ1個のために **loadAggregationData（イベント全期間×org全員の日報+entries）を同期実行**+直列6段 → 集計分離+並列化
- 中 `NotificationBell.tsx:25-28` 60秒ごとに**本文込み50件**を取得（未読数しか使わない） → countOnly エンドポイント
- 低 SWR preload によるデータ先読みが全画面ゼロ（Link prefetch はJSのみ）

#### /submit（日報送信・最重要動線）
- **高** `SubmitPageClientV2.tsx:243-265` 送信ボタンが **POST+送信後画面GET の合計時間ブロック** → POST成功で即 PostSubmitView（スケルトン）、submit-screen は後追い
- **高** `api/me/submit-screen/route.ts:23` + `server/submitScreen/blocks.ts:185,248,263` **loadAggregationData を最大4回（当日分は完全重複）かつ直列** → ctx 共有で1回化+Promise.all
- **高** `api/reports/v2/route.ts:50-116` items 直列×1件4往復、entries 全削除→全挿入 → items 並列+upsert 差分化
- 中 `api/me/report-form/route.ts:22-96` 7段直列（日付変更のたび） → 並列化／meter-baseline が車両タップごと1リクエスト → report-form に同梱／vehicles-unlinked（org全車両）を初期ロードで必ず転送 → タップ時遅延取得／form-notice+shift-deadline-reminder の独立2本 → submit-init に相乗り／前日・翌日の preload なし → P9
- 参考: `SubmitPageClient.tsx`（旧実装1320行）と `/api/reports/today-reward` 等は参照ゼロのデッドコード

#### /report
- 中 走行距離ガードで同一ペイロードを2回POST → 事前チェックAPI分離／vehicles-unlinked をモーダル前に先読み／開くだけで7-8本 → ブートストラップ集約
- OK: 添付は FormData（base64往復なし）

#### /shifts（ドライバー・希望休）
- **高** `(user)/shifts/page.tsx:170-194`+`:103-109` 提出後 void load() の結果が off/requests を丸ごと上書き＝**送信直後の操作が巻き戻る** → `mutate(…,{revalidate:false})` 楽観更新+P3ガード
- 中 月の希望休を全件送信（サーバで差分化）→ クライアント差分化／提出中ブロック → 即時成功表示+背景保存／隣接月 preload なし → P9
- OK: me/shifts API は N+1 回避済み

#### /me・/me/rewards
- **高** `api/me/rewards/route.ts:78` computeDriverAutoPayout が **org全員の月次日報をロードして本人分だけ使う**+3クエリ直列 → driver 絞り込み/事前集計+並列化
- 中 `api/reports/profile/route.ts:17-60` 5段直列（submit と me の基幹API） → 並列化／自由経費の追加/削除が楽観更新なし+重いサマリ全再取得 → mutate+遅延／`api/me/invoices/route.ts:15-44` **全期間+payload丸ごと+署名URL付き**（使うのは承認待ち件数だけ） → status絞り+payload抜き

#### /notifications
- 中 既読1件で50件フルリスト再取得 → mutate ローカル更新／50件固定でページングなし

#### /join・/register
- **高** `OnboardingWizard.tsx:509-511,1394-1398` + `api/me/registration/photo/route.ts:17,32` KYC画像を **base64 JSON POST（+33%転送）**。`/register` も同根 → FormData か署名URL直PUT（`/api/reports/attachments` と同方式）
- 中 tesseract.js 数MB を免許アップ直後にCDN取得 → 遅延プリフェッチ／join成功後の registration 直列GET → レスポンス同梱／各ステップの全画面ブロック → useAutoSave 活用
- OK: `POST /api/me/registration` は body に含まれた項目だけ更新する**差分PUTの手本**

#### ルート /
- 低 session 待ちでリダイレクトが1往復遅れる → キャッシュ即遷移／遷移先データの preload 好機（report-form 等）

#### 先読み候補（ドライバー向けまとめ）
ルート着地→report-form/submit-init preload、BottomNav touchstart、submit の前日/翌日、shifts・rewards の前月/翌月、送信ボタン touchstart で submit-screen 先読み

## §3. 次セッションの着手順（推奨）

**Step 0. セキュリティ（最初に・小さく）**
- `api/admin/daily/reports/[id]/route.ts:50-56` PUT に org_id スコープ追加
- `api/admin/events/[id]/route.ts:33-34`・`api/admin/events/[id]/ranking/route.ts:28-32` に org_id 条件追加

**Step 1. 正確性バグ（静かに壊れる系。全部小さめの修正）**
1. `src/server/aggregation/load.ts:43-62` 単価テーブル群を fetchAllRows 化（過少請求/過少支払の芽）
2. `editorModel.ts:406-445` 請求書編集で attachments が消えるデータ欠落
3. ドライバーセレクタ欠け3箇所（courses page.tsx:264 の limit=20 / InvoiceSheetEditor:111 の100クランプ / sales:1157 の20件）→ **軽量セレクタAPI（id/name/display_name のみ・全件）を1本新設して3箇所で使う**
4. `api/admin/invoices/route.ts:145-158` 一覧に month 必須+ページング
5. unit_fields の org 絞りなし3箇所（carriers/route.ts:22・submit-screen/route.ts:33・events/[id]/route.ts:38-40）
6. `api/admin/misc-reports/oil-change/route.ts:35-43` ORDER BY に id タイブレーク
7. `api/admin/sales/reports/route.ts:102-108`・`api/admin/invoices/draft/route.ts:317-329` shifts のページング

**Step 2. 横断（全画面に効く）**
1. `/api/admin/badges` 統合（AdminLayout 5本+ダッシュボード重複3本→1本、unread-count は軽量集計に）
2. `daily/unread-count` の全履歴走査を廃止（日次サマリ or SQL count）
3. `/api/me/team-status` SWR化+集計分離（全ドライバー画面に効く）
4. Providers or 各ページで revalidateOnFocus 方針統一（重い集計ページは false）

**Step 3. 重い集計の分離（P4 の移植）**
1. daily `day-summary-range?pending=1` の全履歴スキャン解体（+entries 二重読み・drivers 複製も）
2. payments 行展開の全社集計N+1 → バッチAPI化、payments API の直列5本並列化
3. counterparties 展開の全社集計N+1+セルblurごとの全社サマリ再実行
4. submit-screen（ドライバー送信後画面）の loadAggregationData 4回→1回+並列
5. sales の useEffect 7本 SWR化+同一データ4本スキャン統合

**Step 4. 巻き戻り・保存UX（P1/P2/P3 の移植）**
1. daily: all タブ巻き戻り（OtherReportsContent の mutate パターン移植）+編集保存の直列解体
2. courses: 差分PUT+二重保存ガード+7リクエスト削減+並べ替え一括upsert（roles も同型）
3. invoices: スター巻き戻り+PATCH前SELECT削減
4. notifications: 設定タブ巻き戻り+二重ポーリング+GET副作用の分離
5. user shifts: 希望休提出の楽観更新化
6. map: スライダーのデバウンス+vehicles API の DISTINCT ON 化+配置の楽観更新
7. events: RankingTab SWR化+加点後の全再計算廃止、spot-jobs: レスポンス反映+差分送信
8. submit: 送信後画面の後追い化+reports/v2 の並列/upsert 化

**Step 5. 先読み・仕上げ（P8/P9 の移植）**
- 期間ナビ preload: attendance（前後日）/daily・spot-jobs・adjustments・user shifts・rewards（前後月）
- hover/touchstart: courses 単価・events 詳細・payments/counterparties 展開・BottomNav・invoices 一覧行
- join/register の base64 → FormData 化、invoices アップロードの直アップロード化

各 Step 完了ごとに tsc / vitest / next build を回し、worklog に追記する。migration が要るもの（badges 用集計・位置の DISTINCT ON RPC 等）は 131 と同じ「RPC優先+フォールバック」方式で書く（migration 適用は SUPABASE_DB_URL 復旧待ち）。
