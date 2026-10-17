# シフト・日報照合と入力欄の振り分け

## 画面

- 管理の日報確認で、現在のシフトのコース・便と提出された日報を同じ行に並べる。照合は会社のコースIDと便で行い、名前が同じ別コースを一致扱いにしない。
- シフトと一致、未提出、該当シフトなし、重複、入力欄の確認、旧全体日報を区別する。一致は実際の配送内容の正しさを保証する表示ではなく、現在のシフトとの対応を示す。
- シフト外・重複・設定外数量・コース名未確認の未承認日報は、一覧の承認操作を止める。旧全体日報はC1/C2の予定をまとめて1件の実績と照合し、数量を二重表示しない。
- コースの「日報設定」は、ドライバーが見る午前/午後等の入力欄を土台に、そのブロックに記録する便を選ぶ。C1は青、C2は紫で、本人の入力画面と照合画面でも同じ色と便名を使う。4便は別の枠/コースで設定する。
- 実際の入力部品 `ReportFieldInputs` を本人画面と設定画面で共用。項目ごとの例外、共通の項目、使わない欄にも対応する。各便を全項目なしにして未設定時の全許可へ戻す保存は止める。

## 公開範囲

公開前main `a20d6604` から独立checkoutを作成。未公開のbusiness-api移行、撮影/原本確認パネル、広いrole/認証変更、他の保留migrationは含めない。本人フォームは現行の認証・DB経路へ必要な検証だけ追加し、互換リーダーの別件リファクタリングも除いた。車両メーターの反映経路は現行公開版を維持。

- 本番DBへ適用したmigration: `20261017081019_sync_reports_with_shift_changes.sql`、`20261017081031_bind_course_report_fields.sql`。ローカル作成時の023055/033608から、実際の本番履歴のversionへファイル名を揃えた。
- 本番はPostgres17.6、対象表は既にRLS有効。既存のRLS・既存RPCのowner/ACLを維持し、NOLOGIN専用role用の限定policyのみ追加。一般利用者の実行権限を付与しない。所有者を変更するためのSET/CREATE権限はDDL中だけ付与し、完了時に外す。
- 隔離Postgresでも本番に近い非superuser/CREATEROLE/BYPASSRLSの管理者を再現し、role作成・所有者変更・ACL・シフトと提出の並行更新・承認時の項目再確認を検証した。
- 対象日報と2コースの初期設定前状態・明細/単価のhashを、権限0600のローカル証拠へ退避。吉田立汰の10/16分は解除済みの1件だけが補正対象。新しい2件の明細・承認状態・単価は変更しない。

## 検証

Web全1,912テスト（会社境界・承認保持の追加2件を含む）、Web/preview/mobile/base型、tenant静的検査、本番設定を使わないbuild、隔離DB2種が成功。プレビューは下記で起動する。

`npm run preview:admin -- admin --port 3199`

- `/preview/admin/courses?scenario=cycle-fields&role=admin`
- `/preview/admin/daily?scenario=multi-course&role=admin`
- `/preview/admin/daily?scenario=mismatch&role=admin`
- `/preview/admin/daily?scenario=legacy-whole&role=admin`
- `/preview/admin/submit?scenario=cycles`

いずれも本番ページを架空fixtureで再利用し、認証・DB・通知へ接続しない。プレビューの送信・承認はメモリ内だけ。実機のネイティブMobileや、未公開のbusiness境界を含めた一括移行は今回の公開範囲外。

コード番号は [日報と一緒に送る選択項目](../design/daily-report-labels.md) として汎用設計に整理した。今回は機能追加しない。
