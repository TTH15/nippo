# API・権限一覧

この表は `node scripts/generate-api-permissions.mjs` でAPIルートの実装から生成する。対象は 319 操作（224 ルート）。

- 「入口の権限・条件」はルート先頭のガードを示す。会社・所有者・対象状態・追加権限などの処理内条件も適用されるため、この列だけで実行可否は確定しない。
- `requireAuth(req, "DRIVER")` はDRIVERロール限定ではない。認証済み本人の操作を表し、所属状態も検証する。
- `can_*` は会社内ロールの権限。管理者は全権限固定、カスタムロール・経理・閲覧者の実際の付与は会社ごとの `role_capabilities` を参照する。下表は旧ロールデータの既定値であり、現在の会社で付与された権限は「ロール・権限」画面を参照する。
- 自分の希望休などは `works_as_driver` の本人権限も使う。公開API、LINE Webhook、cronは通常のロール認証と別の検証を行う。
- 「個別条件を要確認」は自動抽出できなかった箇所。MCP等の外部公開前に手動監査する。

## 権限と既定ロール

| 権限 | 操作範囲 | 管理者 | 経理 | 閲覧者 | ドライバー |
| --- | --- | :---: | :---: | :---: | :---: |
| `can_access_records` | 記録・報告の画面 | ○ | — | — | — |
| `can_manage_record_forms` | フォーム管理 | ○ | — | — | — |
| `can_view_reports` | 日報の閲覧 | ○ | ○ | ○ | — |
| `can_edit_reports` | 日報の代理入力・修正 | ○ | — | — | — |
| `can_view_shifts` | シフトの閲覧 | ○ | ○ | ○ | — |
| `can_manage_shifts` | シフトの管理（確定・希望休） | ○ | — | — | — |
| `can_dispatch` | 配車（車両割当） | ○ | — | — | — |
| `can_view_rewards` | 報酬・給与の閲覧 | ○ | ○ | ○ | — |
| `can_manage_rewards` | 報酬の管理（単価・締め） | ○ | ○ | — | — |
| `can_view_bank_accounts` | 口座情報の閲覧 | ○ | ○ | — | — |
| `can_view_pii` | 顔・免許の閲覧 | ○ | — | — | — |
| `can_view_vehicles` | 車両の閲覧 | ○ | ○ | ○ | — |
| `can_manage_vehicles` | 車両の管理 | ○ | — | — | — |
| `can_view_vehicle_cost` | 車両の金額情報 | ○ | ○ | — | — |
| `can_view_billing` | 請求・取引先の閲覧 | ○ | ○ | ○ | — |
| `can_manage_billing` | 請求の管理（確定・取引先編集） | ○ | ○ | — | — |
| `can_view_members` | ドライバー名簿の閲覧 | ○ | ○ | ○ | — |
| `can_approve_members` | 参加承認・本人確認 | ○ | — | — | — |
| `can_manage_members` | ロール変更・退会処理 | ○ | — | — | — |
| `can_view_org_settings` | 設定の閲覧 | ○ | ○ | ○ | — |
| `can_manage_org_settings` | 設定の編集（全領域） | ○ | — | — | — |
| `can_manage_courses` | コース／単価表の編集 | ○ | — | — | — |
| `can_manage_carriers` | キャリア／フォーム設計の編集 | ○ | — | — | — |
| `can_manage_report_kinds` | 報告種別の編集 | ○ | — | — | — |
| `can_manage_submit_screen` | 送信後画面の編集 | ○ | — | — | — |
| `can_send_notifications` | 通知の一斉配信 | ○ | — | — | — |

「ドライバーとして扱う」が有効なメンバーには、ロールを問わず本人の日報提出、希望休管理、シフト・報酬閲覧、プロフィール管理の本人権限が付く。本人権限は全社の `can_*` と別に判定される。

## 管理（225件）

| Method | エンドポイント | APIの概要 | 入口の権限・条件 |
| --- | --- | --- | --- |
| GET | `/api/admin/account` | アカウントの取得 | 認証（本人・対象範囲は処理内で確認） |
| GET | `/api/admin/attendance` | 指定日の勤怠（車両セッション）一覧。出退勤・稼働時間・メーター・GPS状態・打刻手段・承認状態 | can_view_vehicles |
| POST | `/api/admin/attendance/[id]` | manual打刻の承認/却下（§8.5）。pending のセッションのみ対象 | can_manage_vehicles |
| GET | `/api/admin/badges` | 管理メニューのバッジ件数をまとめて返す統合エンドポイント | いずれか [ can_view_reports, can_view_vehicles, can_view_members, ] |
| GET | `/api/admin/carriers` | キャリア一覧（units / unit_fields をネストして返す）。当 org が有効化したキャリアのみ | can_view_org_settings |
| POST | `/api/admin/carriers` | キャリア追加 | can_manage_carriers |
| DELETE | `/api/admin/carriers/[id]` | キャリア削除（依存があればハード削除を拒否し、無効化を促す） | can_manage_carriers |
| PATCH | `/api/admin/carriers/[id]` | キャリア更新（name / code / sort_order / active） | can_manage_carriers |
| GET | `/api/admin/counterparties/[id]/billing-detail` | 取引先・請求明細の取得 | can_view_billing |
| PATCH | `/api/admin/counterparties/[id]/custom-lines/[lineId]` | 取引先・調整行の一部更新 | can_manage_billing |
| PATCH | `/api/admin/counterparties/[id]/line-label` | 取引先・行名の一部更新 | can_manage_billing |
| POST | `/api/admin/counterparties/[id]/merge-lines` | 取引先・行統合の作成・送信 | can_manage_billing |
| DELETE | `/api/admin/counterparties/[id]/merged-lines/[mergeId]` | 取引先・統合行の削除 | can_manage_billing |
| PATCH | `/api/admin/counterparties/[id]/merged-lines/[mergeId]` | 取引先・統合行の一部更新 | can_manage_billing |
| PUT | `/api/admin/counterparties/[id]/month-lines` | 取引先・月別明細の更新 | can_manage_billing |
| GET | `/api/admin/counterparties/summary` | 取引先・集計の取得 | can_view_billing |
| GET | `/api/admin/course-billing` | ?course_id=... → そのコースのキャリア配下 unit と現単価 | いずれか [can_view_billing, can_manage_courses] |
| PUT | `/api/admin/course-billing` | 単価保存（新テーブル upsert ＋ 旧 course_rates 同期） | いずれか [can_manage_billing, can_manage_courses] |
| GET | `/api/admin/course-rates` | 全コースの単価 | いずれか [can_view_billing, can_manage_courses] |
| PATCH | `/api/admin/course-rates` | コース単価を更新 | いずれか [can_manage_billing, can_manage_courses] |
| GET | `/api/admin/course-report-fields` | コース報告項目の取得 | いずれか [can_view_billing, can_manage_courses] |
| PUT | `/api/admin/course-report-fields` | コース報告項目の更新 | いずれか [can_manage_billing, can_manage_courses] |
| GET | `/api/admin/courses` | 全コース一覧 | can_view_org_settings |
| PATCH | `/api/admin/courses` | コース並べ替え | can_manage_courses |
| POST | `/api/admin/courses` | コース追加 | can_manage_courses |
| DELETE | `/api/admin/courses/[id]` | コース削除 | can_manage_courses |
| PUT | `/api/admin/courses/[id]` | コース名・色の更新 | can_manage_courses |
| GET | `/api/admin/courses/[id]/cycles` | コース・便の取得 | can_view_org_settings |
| PUT | `/api/admin/courses/[id]/cycles` | コース・便の更新 | can_manage_courses |
| GET | `/api/admin/courses/[id]/drivers` | コース・ドライバーの取得 | いずれか [...[can_manage_courses, can_manage_members]] |
| PUT | `/api/admin/courses/[id]/drivers` | 担当ドライバーを一括更新。{ driverIds: string[] } | いずれか [...[can_manage_courses, can_manage_members]] |
| GET | `/api/admin/daily` | 日報の取得 | can_view_reports |
| GET | `/api/admin/daily/all` | 日報・全件の取得 | can_view_reports |
| POST | `/api/admin/daily/approve` | 日報を承認 | can_edit_reports |
| GET | `/api/admin/daily/day-summary` | 日報・日別集計の取得 | can_view_reports |
| GET | `/api/admin/daily/day-summary-range` | 日報・期間集計の取得 | can_view_reports |
| GET | `/api/admin/daily/pending` | 日報・pendingの取得 | can_view_reports |
| POST | `/api/admin/daily/reject` | 日報を差戻し | can_edit_reports |
| GET | `/api/admin/daily/report-form` | 日報・日報フォームの取得 | can_view_reports |
| PUT | `/api/admin/daily/reports/[id]` | 日報・日報の更新 | can_edit_reports |
| POST | `/api/admin/daily/reports/proxy` | 日報・日報・代理入力の作成・送信 | can_edit_reports |
| GET | `/api/admin/daily/unread-count` | 日報・未読件数の取得 | can_view_reports |
| GET | `/api/admin/driver-ad-hoc-expenses` | 指定ドライバー・月の臨時経費一覧 | can_view_rewards |
| POST | `/api/admin/driver-ad-hoc-expenses` | 臨時経費を1件追加 | can_manage_rewards |
| DELETE | `/api/admin/driver-ad-hoc-expenses/[id]` | 臨時経費を削除 | can_manage_rewards |
| PATCH | `/api/admin/driver-ad-hoc-expenses/[id]` | 臨時経費を更新 | can_manage_rewards |
| GET | `/api/admin/driver-expenses` | ドライバーごとの固定経費一覧 | can_view_rewards |
| POST | `/api/admin/driver-expenses` | 固定経費の新規登録 | can_manage_rewards |
| DELETE | `/api/admin/driver-expenses/[id]` | 固定経費の削除 | can_manage_rewards |
| PATCH | `/api/admin/driver-expenses/[id]` | 固定経費の更新 | can_manage_rewards |
| GET | `/api/admin/driver-lease` | ドライバーリースの取得 | いずれか [can_view_rewards, can_manage_rewards] |
| PUT | `/api/admin/driver-lease` | ドライバーリースの更新 | can_manage_rewards |
| GET | `/api/admin/driver-rewards` | ドライバー報酬の取得 | can_view_rewards |
| GET | `/api/admin/events` | イベント一覧 | can_view_org_settings |
| POST | `/api/admin/events` | イベント作成 | can_manage_org_settings |
| DELETE | `/api/admin/events/[id]` | イベント削除（FK CASCADE で teams/members/points も削除） | can_manage_org_settings |
| GET | `/api/admin/events/[id]` | イベント詳細（teams / members / 採点UI用の drivers を同梱） | can_view_org_settings |
| PATCH | `/api/admin/events/[id]` | イベント更新（名称/説明/期間/status/採点ルール） | can_manage_org_settings |
| DELETE | `/api/admin/events/[id]/members` | ドライバーをイベントのチームから外す | can_manage_org_settings |
| POST | `/api/admin/events/[id]/members` | ドライバーをチームへ割当（移動も兼ねる。1イベント1ドライバー1チーム） | can_manage_org_settings |
| GET | `/api/admin/events/[id]/points` | 手動ポイント一覧（source='manual'） | can_view_org_settings |
| POST | `/api/admin/events/[id]/points` | 手動ポイント追加（個人 or チーム） | can_manage_org_settings |
| DELETE | `/api/admin/events/[id]/points/[entryId]` | 手動ポイント削除 | can_manage_org_settings |
| GET | `/api/admin/events/[id]/ranking` | ランキング（期間内の日報を採点ルールでライブ計算 + 手動加点） | can_view_org_settings |
| POST | `/api/admin/events/[id]/teams` | チーム追加 | can_manage_org_settings |
| DELETE | `/api/admin/events/[id]/teams/[teamId]` | チーム削除（メンバーは CASCADE、points.team_id は SET NULL） | can_manage_org_settings |
| PATCH | `/api/admin/events/[id]/teams/[teamId]` | チーム更新（名前/色/並び） | can_manage_org_settings |
| GET | `/api/admin/invites` | invitesの取得 | can_view_members |
| POST | `/api/admin/invites` | invitesの作成・送信 | can_approve_members |
| DELETE | `/api/admin/invites/[id]` | 単回招待の失効（revoked_at を刻む）。org ガード。使用済みはそのまま（履歴保持） | can_approve_members |
| GET | `/api/admin/invoice-addresses` | 法人アドレス一覧（会社コードでフィルタ） | can_view_billing |
| POST | `/api/admin/invoice-addresses` | 法人アドレス新規登録 | can_manage_billing |
| DELETE | `/api/admin/invoice-addresses/[id]` | 法人アドレス削除 | can_manage_billing |
| PUT | `/api/admin/invoice-addresses/[id]` | 法人アドレス更新 | can_manage_billing |
| GET | `/api/admin/invoice-principal` | invoice principalの取得 | can_view_billing |
| GET | `/api/admin/invoices` | 請求書の取得 | can_view_billing |
| POST | `/api/admin/invoices` | 請求書の作成・送信 | can_manage_billing |
| DELETE | `/api/admin/invoices/[id]` | 請求書の削除 | can_manage_billing |
| GET | `/api/admin/invoices/[id]` | 請求書の取得 | can_view_billing |
| PATCH | `/api/admin/invoices/[id]` | 請求書の一部更新 | can_manage_billing |
| GET | `/api/admin/invoices/[id]/staleness` | 請求書・stalenessの取得 | can_view_billing |
| POST | `/api/admin/invoices/attachments` | 請求書・attachmentsの作成・送信 | can_manage_billing |
| GET | `/api/admin/invoices/draft` | 請求書・draftの取得 | can_view_billing |
| POST | `/api/admin/invoices/from-source` | 請求書・from sourceの作成・送信 | can_manage_billing |
| GET | `/api/admin/join-code` | 当 org の現在の参加コードを返す | can_view_members |
| POST | `/api/admin/join-code` | 参加コードの作成・送信 | can_manage_members |
| GET | `/api/admin/map/course-areas` | 地図に重ねるためのコース一覧（色付き）。エリア未設定のコースも返す | can_view_vehicles |
| DELETE | `/api/admin/map/course-areas/[id]` | 地図・course areasの削除 | can_manage_courses |
| PUT | `/api/admin/map/course-areas/[id]` | 地図・course areasの更新 | can_manage_courses |
| GET | `/api/admin/map/movements` | 地図・movementsの取得 | can_view_vehicles |
| PATCH | `/api/admin/map/movements` | 地図・movementsの一部更新 | can_dispatch |
| POST | `/api/admin/map/movements` | 地図・movementsの作成・送信 | can_dispatch |
| GET | `/api/admin/map/parking-slots` | 地図・parking slotsの取得 | can_view_vehicles |
| POST | `/api/admin/map/parking-slots` | 地図・parking slotsの作成・送信 | can_manage_org_settings |
| DELETE | `/api/admin/map/parking-slots/[id]` | 地図・parking slotsの削除 | can_manage_org_settings |
| PATCH | `/api/admin/map/parking-slots/[id]` | 地図・parking slotsの一部更新 | can_manage_org_settings |
| GET | `/api/admin/map/places` | 地図（ベータ）の拠点ピン一覧 | can_view_vehicles |
| POST | `/api/admin/map/places` | 拠点ピンを追加 { name, lat, lng, icon, radiusM?, allowParking? } | can_manage_org_settings |
| DELETE | `/api/admin/map/places/[id]` | 拠点ピンを削除（自テナントのもののみ） | can_manage_org_settings |
| PATCH | `/api/admin/map/places/[id]` | 拠点の編集（名称・種別・位置・範囲・日報の置き場所の候補に出すか） | can_manage_org_settings |
| POST | `/api/admin/map/positions` | 地図上で車両をドラッグして置いた位置を記録する（source='manual'） | can_dispatch |
| GET | `/api/admin/map/share-session` | 地図・share sessionの取得 | cap as Parameters<typeof requirePermission>[1] |
| GET | `/api/admin/map/vehicles` | 地図・車両の取得 | can_view_vehicles |
| GET | `/api/admin/misc-reports/oil-change` | misc reports・oil changeの取得 | can_view_vehicles |
| POST | `/api/admin/misc-reports/oil-change/approve` | misc reports・oil changeを承認 | can_manage_vehicles |
| POST | `/api/admin/misc-reports/oil-change/reject` | misc reports・oil changeを差戻し | can_manage_vehicles |
| GET | `/api/admin/misc-reports/oil-change/unread-count` | misc reports・oil change・未読件数の取得 | can_view_vehicles |
| GET | `/api/admin/monthly` | monthlyの取得 | can_view_rewards |
| GET | `/api/admin/notifications` | 配信対象になりうるメンバーと LINE 連携状況の一覧＋直近の送信履歴 | can_send_notifications |
| POST | `/api/admin/notifications/broadcast` | 通知・broadcastの作成・送信 | can_send_notifications |
| GET | `/api/admin/notifications/chats` | 通知・chatsの取得 | can_send_notifications |
| GET | `/api/admin/notifications/chats/[driverId]` | 通知・chatsの取得 | can_send_notifications |
| PATCH | `/api/admin/notifications/chats/[driverId]` | inbound の既読化。GET の副作用として毎ポーリング書き込んでいたのを分離した | can_send_notifications |
| POST | `/api/admin/notifications/chats/[driverId]` | 通知・chatsの作成・送信 | can_send_notifications |
| GET | `/api/admin/notifications/quota` | 通知・quotaの取得 | can_send_notifications |
| GET | `/api/admin/notifications/settings` | 通知・settingsの取得 | can_send_notifications |
| PUT | `/api/admin/notifications/settings` | 通知・settingsの更新 | can_send_notifications |
| GET | `/api/admin/notifications/undelivered` | 通知・undeliveredの取得 | can_send_notifications |
| POST | `/api/admin/notifications/undelivered` | 通知・undeliveredの作成・送信 | can_send_notifications |
| GET | `/api/admin/oil-forecast` | oil forecastの取得 | can_view_shifts |
| DELETE | `/api/admin/org/vehicle-colors` | 会社設定・車両色の削除 | can_manage_vehicles |
| GET | `/api/admin/org/vehicle-colors` | 会社設定・車両色の取得 | can_view_vehicles |
| POST | `/api/admin/org/vehicle-colors` | 会社設定・車両色の作成・送信 | can_manage_vehicles |
| GET | `/api/admin/organization-settings` | organization settingsの取得 | can_view_org_settings |
| PUT | `/api/admin/organization-settings` | organization settingsの更新 | can_manage_org_settings |
| GET | `/api/admin/payments` | 支払の取得 | can_view_rewards |
| GET | `/api/admin/payments/driver-breakdown` | 支払・driver breakdownの取得 | can_view_rewards |
| GET | `/api/admin/photo-capture-tasks` | 撮影項目の取得 | can_view_org_settings |
| PUT | `/api/admin/photo-capture-tasks` | 撮影項目の更新 | can_manage_org_settings |
| DELETE | `/api/admin/report-image-templates` | report image templatesの削除 | can_manage_carriers |
| GET | `/api/admin/report-image-templates` | report image templatesの取得 | can_manage_carriers |
| PATCH | `/api/admin/report-image-templates` | report image templatesの一部更新 | can_manage_carriers |
| POST | `/api/admin/report-image-templates` | report image templatesの作成・送信 | can_manage_carriers |
| GET | `/api/admin/report-image-templates/sample` | report image templates・sampleの取得 | can_manage_carriers |
| POST | `/api/admin/report-image-templates/sample` | report image templates・sampleの作成・送信 | can_manage_carriers |
| GET | `/api/admin/report-kinds` | 全種別（管理画面の設定用） | can_view_org_settings |
| POST | `/api/admin/report-kinds` | 種別を追加（フォームビルダー: fields/vehicleMode） | can_manage_report_kinds |
| DELETE | `/api/admin/report-kinds/[id]` | 種別を削除。既存の報告データは text の report_kind を保持（ラベルはキー表示にフォールバック） | can_manage_report_kinds |
| PATCH | `/api/admin/report-kinds/[id]` | 種別を更新（key は不変＝既存報告との対応を保つ） | can_manage_report_kinds |
| GET | `/api/admin/report-source-images` | report source imagesの取得 | can_view_reports |
| GET | `/api/admin/report-source-images/file` | report source images・fileの取得 | can_view_reports |
| GET | `/api/admin/reports-summary` | reports summaryの取得 | can_view_reports |
| GET | `/api/admin/reports/source-images` | 日報・原票画像の取得 | can_view_reports |
| GET | `/api/admin/roles` | ロールの取得 | can_view_members |
| PATCH | `/api/admin/roles` | ロールの並べ替え（{ order: roleId[] }）。org 内の全ロールを対象に 0,10,20… で振り直す | can_manage_members |
| POST | `/api/admin/roles` | ロールの作成・送信 | can_manage_members |
| DELETE | `/api/admin/roles/[id]` | ロールの削除 | can_manage_members |
| PATCH | `/api/admin/roles/[id]` | ロールの一部更新 | can_manage_members |
| GET | `/api/admin/sales` | salesの取得 | can_view_billing |
| GET | `/api/admin/sales/log` | 期間内のログ明細（種別名・ドライバー名・車両ラベル付き） | can_view_billing |
| POST | `/api/admin/sales/log` | 1件追加 | can_manage_billing |
| DELETE | `/api/admin/sales/log/[id]` | sales・logの削除 | can_manage_billing |
| PATCH | `/api/admin/sales/log/[id]` | sales・logの一部更新 | can_manage_billing |
| GET | `/api/admin/sales/log/types` | 種別一覧 | いずれか [can_view_billing, can_view_org_settings] |
| POST | `/api/admin/sales/log/types` | 種別を追加 | いずれか [can_manage_billing, can_manage_org_settings] |
| GET | `/api/admin/sales/reports` | sales・日報の取得 | can_view_billing |
| GET | `/api/admin/shift-deadlines` | ルール一覧 + ドライバー一覧 | can_view_shifts |
| PUT | `/api/admin/shift-deadlines` | ルールを全置換で保存 | can_manage_shifts |
| GET | `/api/admin/shift-slots` | 便一覧 + ドライバー一覧 | いずれか [can_view_shifts, can_view_org_settings] |
| PUT | `/api/admin/shift-slots` | 便マスタ＋割り当てを保存 | can_manage_shifts |
| GET | `/api/admin/shifts` | 指定期間のシフト取得 | can_view_shifts |
| POST | `/api/admin/shifts` | シフト登録/更新 | can_manage_shifts |
| PATCH | `/api/admin/shifts/driver-order` | シフト・driver orderの一部更新 | can_manage_shifts |
| POST | `/api/admin/shifts/import` | シフト表ファイル（PDF/画像）を AI で読み取り、 | can_manage_shifts |
| POST | `/api/admin/shifts/import/apply` | AI 取り込みで確定した割当を shifts に一括登録する | can_manage_shifts |
| GET | `/api/admin/shifts/import/batches` | 直近の取り込みバッチ一覧（取り消し UI 用） | can_manage_shifts |
| POST | `/api/admin/shifts/import/batches/[id]/revert` | 取り込みバッチの取り消し | can_manage_shifts |
| GET | `/api/admin/shifts/memo` | シフト・memoの取得 | can_view_shifts |
| PUT | `/api/admin/shifts/memo` | シフト・memoの更新 | can_manage_shifts |
| GET | `/api/admin/shifts/memo/board` | シフト・memo・boardの取得 | can_view_shifts |
| PATCH | `/api/admin/shifts/memo/board` | シフト・memo・boardの一部更新 | can_manage_shifts |
| POST | `/api/admin/shifts/memo/reflect` | シフト・memo・reflectの作成・送信 | can_manage_shifts |
| GET | `/api/admin/shifts/pending-changes` | シフト・pending changesの取得 | can_manage_shifts |
| POST | `/api/admin/shifts/pending-changes` | シフト・pending changesの作成・送信 | can_send_notifications |
| GET | `/api/admin/shifts/readiness` | シフト・readinessの取得 | can_view_shifts |
| GET | `/api/admin/shifts/readiness-settings` | シフト・readiness settingsの取得 | can_view_shifts |
| PUT | `/api/admin/shifts/readiness-settings` | シフト・readiness settingsの更新 | can_manage_shifts |
| DELETE | `/api/admin/shifts/requests/[id]` | シフト・申請の削除 | can_manage_shifts |
| GET | `/api/admin/shifts/requests/history` | 指定ドライバー×日付の希望休 変更履歴（時系列）。運営UIの初回提出/最終変更表示用 | can_view_shifts |
| GET | `/api/admin/shifts/requirements` | シフト・requirementsの取得 | can_view_shifts |
| PUT | `/api/admin/shifts/requirements` | シフト・requirementsの更新 | can_manage_shifts |
| POST | `/api/admin/shifts/times` | シフト行の時間・集合場所の個別上書き（A2 時間モデル） | can_manage_shifts |
| POST | `/api/admin/shifts/vehicle` | シフト行への車両割当（配車）。シフト編集（can_manage_shifts）から独立した | can_dispatch |
| POST | `/api/admin/shifts/vehicle-loans` | 車両の日毎の貸出中を設定/解除（loaned で切替） | いずれか [can_dispatch, can_manage_vehicles] |
| GET | `/api/admin/spot-jobs` | 単発案件一覧＋参加者ピッカー候補 | can_view_shifts |
| POST | `/api/admin/spot-jobs` | 単発案件を作成（参加者込み） | can_manage_shifts |
| DELETE | `/api/admin/spot-jobs/[id]` | 単発案件を削除（参加者は CASCADE で消える） | can_manage_shifts |
| PATCH | `/api/admin/spot-jobs/[id]` | 単発案件の編集。members を渡すと参加者を丸ごと置き換える | can_manage_shifts |
| POST | `/api/admin/spot-jobs/guests` | ゲストメンバーを作成 { name } | can_manage_shifts |
| GET | `/api/admin/submit-screen` | 設定 ＋ 設定UI用の drivers / carriers→units→fields | can_view_org_settings |
| PUT | `/api/admin/submit-screen` | 設定を保存 | can_manage_submit_screen |
| POST | `/api/admin/unit-fields` | 報告フィールド追加 | can_manage_carriers |
| DELETE | `/api/admin/unit-fields/[id]` | 報告フィールド削除（report_entries は field_key 文字列参照のため FK 連鎖なし） | can_manage_carriers |
| PATCH | `/api/admin/unit-fields/[id]` | 報告フィールド更新 | can_manage_carriers |
| POST | `/api/admin/units` | unit 追加 | いずれか [can_manage_carriers, can_manage_courses] |
| DELETE | `/api/admin/units/[id]` | unit 削除（単価/報告で利用中ならハード削除を拒否） | いずれか [can_manage_carriers, can_manage_courses] |
| PATCH | `/api/admin/units/[id]` | unit 更新 | いずれか [can_manage_carriers, can_manage_courses] |
| GET | `/api/admin/users` | 全ドライバー一覧（コース情報含む） | can_view_members |
| POST | `/api/admin/users` | 新規ドライバー追加 | can_manage_members |
| DELETE | `/api/admin/users/[id]` | ドライバー削除 | can_manage_members |
| GET | `/api/admin/users/[id]` | ドライバー詳細（編集用） | can_view_members |
| PUT | `/api/admin/users/[id]` | ドライバー更新 | can_manage_members |
| GET | `/api/admin/users/[id]/kyc` | メンバー・kycの取得 | can_view_pii |
| POST | `/api/admin/users/[id]/kyc-check` | メンバー・kyc checkの作成・送信 | can_view_pii |
| DELETE | `/api/admin/users/[id]/phone` | メンバー・phoneの削除 | can_manage_members |
| POST | `/api/admin/users/[id]/verify-kyc` | メンバー・verify kycの作成・送信 | can_approve_members |
| GET | `/api/admin/users/license-alert-count` | 運転免許証の更新が迫っている（接近 or 期限切れ）ドライバーの人数（互換維持） | can_view_members |
| GET | `/api/admin/users/pending-count` | 参加承認待ち（status='pending'）の申請件数（互換維持） | can_view_members |
| POST | `/api/admin/vehicle-qr/activate` | 貼付確認（有効化）。車両に貼ったQRを ADMIN が実機スキャンし、 | can_manage_vehicles |
| POST | `/api/admin/vehicle-qr/bulk` | 複数車両のQRを一括 get-or-create（冪等）してラベル用データを返す | can_manage_vehicles |
| GET | `/api/admin/vehicles` | 車両一覧。?limit=&cursor=（cursor は offset）でページング | can_view_vehicles |
| POST | `/api/admin/vehicles` | 車両追加 | can_manage_vehicles |
| DELETE | `/api/admin/vehicles/[id]` | 車両削除 | can_manage_vehicles |
| PUT | `/api/admin/vehicles/[id]` | 車両情報更新 | can_manage_vehicles |
| GET | `/api/admin/vehicles/[id]/detail` | 車両・detailの取得 | can_view_vehicles |
| GET | `/api/admin/vehicles/[id]/meter-logs` | 車両・meter logsの取得 | can_view_vehicles |
| GET | `/api/admin/vehicles/[id]/qr` | この車両の現在のQR（非revoked）を返す。ラベル印刷/状態表示用 | can_view_vehicles |
| POST | `/api/admin/vehicles/[id]/qr` | QR発行/再発行。再発行は既存QRを即失効させるため confirm を必須にする（§8.4） | can_manage_vehicles |
| GET | `/api/admin/vehicles/[id]/recovery` | 1車両の初期費用回収の内訳（繰越＋自動カレンダー月＋日額自動計上＋手動行） | can_view_vehicle_cost |
| PUT | `/api/admin/vehicles/[id]/recovery-collected` | 特定月の回収済みマークを更新（collected: true でマーク、日付記録 / false で解除） | can_manage_vehicles |
| DELETE | `/api/admin/vehicles/[id]/recovery-entries` | ?entry_id= で手動回収行を削除 | can_manage_vehicles |
| POST | `/api/admin/vehicles/[id]/recovery-entries` | 月に紐づく手動回収行を追加 | can_manage_vehicles |
| GET | `/api/admin/vehicles/check-number` | 車両・check numberの取得 | can_manage_vehicles |
| GET | `/api/admin/vehicles/oil-alert-count` | オイル交換が迫っている（接近 or 要交換）車両の台数（互換維持） | can_view_vehicles |
| GET | `/api/admin/vehicles/recovery` | 全車両の回収済み額・残額（回収v2の集計だけを返す軽量エンドポイント） | can_view_vehicles |

## apply（1件）

| Method | エンドポイント | APIの概要 | 入口の権限・条件 |
| --- | --- | --- | --- |
| POST | `/api/apply` | applyの作成・送信 | 公開応募。入力検証・レート制限を個別確認 |

## 認証（10件）

| Method | エンドポイント | APIの概要 | 入口の権限・条件 |
| --- | --- | --- | --- |
| POST | `/api/auth/login` | 認証・loginの作成・送信 | 公開ログイン。資格情報を検証 |
| GET | `/api/auth/reauth` | 認証・reauthの取得 | 認証（本人・対象範囲は処理内で確認） |
| POST | `/api/auth/reauth/options` | 認証・reauth・optionsの作成・送信 | 認証（本人・対象範囲は処理内で確認） |
| POST | `/api/auth/reauth/verify` | 認証・reauthを検証 | 認証（本人・対象範囲は処理内で確認） |
| POST | `/api/auth/recover/verify` | 認証・recoverを検証 | 公開のアカウント復旧。復旧コード等を検証 |
| GET | `/api/auth/session` | 現在のトークンの持ち主について、DB上の最新ロール・capabilityでセッションを再発行する | 認証（本人・対象範囲は処理内で確認） |
| POST | `/api/auth/webauthn/login/options` | 認証・webauthn・login・optionsの作成・送信 | 公開のPasskeyログイン開始。チャレンジを発行 |
| POST | `/api/auth/webauthn/login/verify` | 認証・webauthn・loginを検証 | 公開のPasskeyログイン。署名とチャレンジを検証 |
| POST | `/api/auth/webauthn/register/options` | 認証・webauthn・register・optionsの作成・送信 | 認証（本人・対象範囲は処理内で確認） |
| POST | `/api/auth/webauthn/register/verify` | 認証・webauthn・registerを検証 | 認証（本人・対象範囲は処理内で確認） |

## 定期処理（1件）

| Method | エンドポイント | APIの概要 | 入口の権限・条件 |
| --- | --- | --- | --- |
| GET | `/api/cron/daily-notifications` | 定期処理・daily notificationsの取得 | CRON_SECRETで認証する定期処理 |

## 参加（2件）

| Method | エンドポイント | APIの概要 | 入口の権限・条件 |
| --- | --- | --- | --- |
| POST | `/api/join` | 参加の作成・送信 | 公開の会社参加。招待コードと登録内容を検証 |
| GET | `/api/join/lookup` | 参加・lookupの取得 | 公開の参加コード照会。コードを検証 |

## LINE（1件）

| Method | エンドポイント | APIの概要 | 入口の権限・条件 |
| --- | --- | --- | --- |
| POST | `/api/line/webhook` | LINE・Webhookの作成・送信 | LINE署名を検証する外部Webhook |

## 本人（35件）

| Method | エンドポイント | APIの概要 | 入口の権限・条件 |
| --- | --- | --- | --- |
| POST | `/api/me/bonus-seen` | ボーナス付与演出を表示したので既読時刻を now() に進める | 認証（本人・対象範囲は処理内で確認） |
| GET | `/api/me/form-notice` | 本人・form noticeの取得 | 認証（本人・対象範囲は処理内で確認） |
| GET | `/api/me/invoices` | 本人・請求書の取得 | 認証（本人・対象範囲は処理内で確認） |
| GET | `/api/me/invoices/[id]` | 本人・請求書の取得 | 認証（本人・対象範囲は処理内で確認） |
| POST | `/api/me/invoices/[id]/approve` | 本人・請求書を承認 | 認証（本人・対象範囲は処理内で確認） |
| DELETE | `/api/me/line` | 本人・LINEの削除 | 認証（本人・対象範囲は処理内で確認） |
| GET | `/api/me/line` | 連携状態（未連携/連携済み/ブロック中） | 認証（本人・対象範囲は処理内で確認） |
| POST | `/api/me/line` | 本人・LINEの作成・送信 | 認証（本人・対象範囲は処理内で確認） |
| GET | `/api/me/login-setup` | 本人・login setupの取得 | 認証（本人・対象範囲は処理内で確認） |
| GET | `/api/me/notifications` | 本人・通知の取得 | 認証（本人・対象範囲は処理内で確認） |
| PATCH | `/api/me/notifications` | 本人・通知の一部更新 | 認証（本人・対象範囲は処理内で確認） |
| GET | `/api/me/optional-expenses` | 指定月の自由経費一覧 | 認証（本人・対象範囲は処理内で確認） |
| POST | `/api/me/optional-expenses` | 自由経費を1件追加 | 認証（本人・対象範囲は処理内で確認） |
| DELETE | `/api/me/optional-expenses/[id]` | 自由経費を削除 | 認証（本人・対象範囲は処理内で確認） |
| PATCH | `/api/me/optional-expenses/[id]` | 自由経費を更新 | 認証（本人・対象範囲は処理内で確認） |
| DELETE | `/api/me/passkeys` | 本人・passkeysの削除 | 認証（本人・対象範囲は処理内で確認） |
| GET | `/api/me/passkeys` | 本人・passkeysの取得 | 認証（本人・対象範囲は処理内で確認） |
| POST | `/api/me/phone/send` | 本人・phoneを送信 | 認証（本人・対象範囲は処理内で確認） |
| POST | `/api/me/phone/verify` | 本人・phoneを検証 | 認証（本人・対象範囲は処理内で確認） |
| DELETE | `/api/me/push` | 本人・pushの削除 | 認証（本人・対象範囲は処理内で確認） |
| GET | `/api/me/push` | 公開鍵と、この端末が購読済みかの判定材料 | 認証（本人・対象範囲は処理内で確認） |
| POST | `/api/me/push` | 本人・pushの作成・送信 | 認証（本人・対象範囲は処理内で確認） |
| GET | `/api/me/registration` | 本登録の現在状態（プリフィル＋完了判定） | 認証（本人・対象範囲は処理内で確認） |
| POST | `/api/me/registration` | 本登録のテキスト項目を「部分更新」で保存（ウィザードのステップごと） | 認証（本人・対象範囲は処理内で確認） |
| POST | `/api/me/registration/photo` | 本人・registration・photoの作成・送信 | 認証（本人・対象範囲は処理内で確認） |
| GET | `/api/me/report-form` | 本人・日報フォームの取得 | 認証（本人・対象範囲は処理内で確認） |
| GET | `/api/me/report-image-templates` | 本人・report image templatesの取得 | 認証（本人・対象範囲は処理内で確認） |
| GET | `/api/me/report-kinds` | 本人・報告種別の取得 | 認証（本人・対象範囲は処理内で確認） |
| GET | `/api/me/rewards` | 本人・報酬の取得 | 認証（本人・対象範囲は処理内で確認） |
| GET | `/api/me/shift-confirmations` | 本人・shift confirmationsの取得 | 範囲 { own: own_view_shifts, any: can_view_shifts } |
| POST | `/api/me/shift-confirmations` | 本人・shift confirmationsの作成・送信 | 範囲 { own: own_view_shifts, any: can_view_shifts } |
| GET | `/api/me/shift-deadline-reminder` | 本人・shift deadline reminderの取得 | 認証（本人・対象範囲は処理内で確認） |
| GET | `/api/me/shifts` | 本人・シフトの取得 | 範囲 { own: own_view_shifts, any: can_view_shifts, } |
| GET | `/api/me/submit-screen` | 本人・submit screenの取得 | 認証（本人・対象範囲は処理内で確認） |
| GET | `/api/me/team-status` | 本人・team statusの取得 | 認証（本人・対象範囲は処理内で確認） |

## 認証コード（1件）

| Method | エンドポイント | APIの概要 | 入口の権限・条件 |
| --- | --- | --- | --- |
| POST | `/api/otp/send` | 認証コードを送信 | 認証コード送信。送信先・レート制限を検証 |

## platform（3件）

| Method | エンドポイント | APIの概要 | 入口の権限・条件 |
| --- | --- | --- | --- |
| GET | `/api/platform/applications` | platform・applicationsの取得 | プラットフォーム運営者限定 |
| PATCH | `/api/platform/applications/[id]` | platform・applicationsの一部更新 | プラットフォーム運営者限定 |
| GET | `/api/platform/orgs` | platform・orgsの取得 | プラットフォーム運営者限定 |

## 記録フォーム（7件）

| Method | エンドポイント | APIの概要 | 入口の権限・条件 |
| --- | --- | --- | --- |
| GET | `/api/record-forms` | 記録フォームの取得 | 認証＋フォームごとの閲覧範囲。管理はcan_manage_record_forms |
| POST | `/api/record-forms` | 記録フォームの作成・送信 | can_manage_record_forms |
| PUT | `/api/record-forms/[formId]` | 記録フォームの更新 | can_manage_record_forms |
| GET | `/api/record-forms/[formId]/records` | 記録フォーム・記録の取得 | 認証＋フォームごとの閲覧範囲 |
| POST | `/api/record-forms/[formId]/records` | 記録フォーム・記録の作成・送信 | 認証＋フォームごとの提出/管理範囲 |
| GET | `/api/record-forms/[formId]/records/[recordId]` | 記録フォーム・記録の取得 | 認証＋フォーム・記録ごとの閲覧範囲 |
| PATCH | `/api/record-forms/[formId]/records/[recordId]` | 記録フォーム・記録の一部更新 | 認証＋フォーム・記録ごとの編集範囲 |

## 日報（19件）

| Method | エンドポイント | APIの概要 | 入口の権限・条件 |
| --- | --- | --- | --- |
| POST | `/api/reports` | 日報の作成・送信 | 認証（本人・対象範囲は処理内で確認） |
| POST | `/api/reports/attachments` | 日報・attachmentsの作成・送信 | 認証（本人・対象範囲は処理内で確認） |
| GET | `/api/reports/day` | 日報・dayの取得 | 認証（本人・対象範囲は処理内で確認） |
| GET | `/api/reports/me` | 日報・本人の取得 | 認証（本人・対象範囲は処理内で確認） |
| GET | `/api/reports/monthly-totals` | 日報・monthly totalsの取得 | 認証（本人・対象範囲は処理内で確認） |
| POST | `/api/reports/oil-change` | 日報・oil changeの作成・送信 | 認証（本人・対象範囲は処理内で確認） |
| GET | `/api/reports/parking-places` | 日報の「車の置き場所」で選べる登録車庫と区画（ドライバー向け・自社の候補だけ） | 認証（本人・対象範囲は処理内で確認） |
| GET | `/api/reports/profile` | 日報・profileの取得 | 認証（本人・対象範囲は処理内で確認） |
| PATCH | `/api/reports/profile` | 日報・profileの一部更新 | 認証（本人・対象範囲は処理内で確認） |
| GET | `/api/reports/source-images` | 日報・原票画像の取得 | 認証（本人・対象範囲は処理内で確認） |
| POST | `/api/reports/source-images` | 日報・原票画像の作成・送信 | 認証（本人・対象範囲は処理内で確認） |
| GET | `/api/reports/source-images/readings` | 日報・原票画像・readingsの取得 | 認証（本人・対象範囲は処理内で確認） |
| POST | `/api/reports/source-images/readings` | 日報・原票画像・readingsの作成・送信 | 認証（本人・対象範囲は処理内で確認） |
| GET | `/api/reports/today-reward` | 日報・today rewardの取得 | 認証（本人・対象範囲は処理内で確認） |
| POST | `/api/reports/v2` | 日報・v2の作成・送信 | 認証（本人・対象範囲は処理内で確認） |
| GET | `/api/reports/vehicle-preference` | ドライバーの最終選択車両 | 認証（本人・対象範囲は処理内で確認） |
| PUT | `/api/reports/vehicle-preference` | ドライバーの最終選択車両を保存 | 認証（本人・対象範囲は処理内で確認） |
| GET | `/api/reports/vehicles` | ドライバーが選択可能な車両一覧 | 認証（本人・対象範囲は処理内で確認） |
| GET | `/api/reports/vehicles-unlinked` | 現在のドライバーに紐付けられていない車両一覧（他ドライバーに紐付いている可能性あり） | 認証（本人・対象範囲は処理内で確認） |

## シフト（3件）

| Method | エンドポイント | APIの概要 | 入口の権限・条件 |
| --- | --- | --- | --- |
| GET | `/api/shifts/deadlines` | 指定月(YYYY-MM)の、そのドライバーの提出期間と締切・ロック状態を返す | 認証（本人・対象範囲は処理内で確認） |
| GET | `/api/shifts/requests` | 自分の希望休一覧（便付き）＋ 自分が使う便 | 範囲 { own: own_manage_shift_requests, any: can_view_shifts, } |
| POST | `/api/shifts/requests` | 希望休の一括登録（month + offEntries[/offDates]）または単体（date + isOff） | 範囲 { own: own_manage_shift_requests, any: can_manage_shifts, } |

## 車両QR（1件）

| Method | エンドポイント | APIの概要 | 入口の権限・条件 |
| --- | --- | --- | --- |
| POST | `/api/vehicle-qr/resolve` | ドライバーが車両QRをスキャンしたときの解決 | 認証＋会社所属 |

## 稼働（10件）

| Method | エンドポイント | APIの概要 | 入口の権限・条件 |
| --- | --- | --- | --- |
| POST | `/api/work/check-in` | 出勤打刻（チェックイン）。車両QRが先頭（§2） | 認証＋会社所属 |
| POST | `/api/work/check-out` | 退勤打刻（チェックアウト）。★QRは最後（§3-0） | 認証＋会社所属 |
| POST | `/api/work/inspection-photo` | 車両点検写真（前後左右4方向）を非公開 Storage にアップロードし、保存パスを返す | 認証＋会社所属 |
| GET | `/api/work/location` | 稼働・位置情報の取得 | 認証＋会社所属＋本人の稼働セッション |
| POST | `/api/work/location` | 稼働・位置情報の作成・送信 | 認証＋会社所属＋本人の稼働セッション |
| POST | `/api/work/meter-photo` | メーター写真を非公開 Storage にアップロードし、保存パスを返す | 認証＋会社所属 |
| POST | `/api/work/parking` | 稼働・駐車の作成・送信 | 認証＋会社所属 |
| GET | `/api/work/photo-capture-tasks` | 稼働・撮影項目の取得 | 認証＋会社所属 |
| POST | `/api/work/plate-photo` | QRが読めない時の退避ルート（vehicle-session-flow §8.5）で撮るナンバープレート写真を | 認証＋会社所属 |
| GET | `/api/work/today` | ドライバーの当日の業務状態。アプリ復帰時の同期に使う | 認証＋会社所属 |
