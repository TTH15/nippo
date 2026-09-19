# org 列が無い表を検査対象に載せる作業と、その過程で見つかった抜け（2026-09-18）

前提は [2026-09-18-shift-tenant-gaps.md](2026-09-18-shift-tenant-gaps.md)。
`check:tenant`（構成A でRLSを使わない代わりの静的検査）は **org 列を持つ表しか見ない**。
本番の103表のうち49表に org 列が無く、検査の外にあった。列を足して検査対象に載せ、
検出された呼び出しを1件ずつ読む、という作業の記録。

**本番で悪用された形跡を確認したわけではない**（アクセスログの調査はしていない）。
修正はすべてローカル。migration も未適用。

## 見つかった抜け（実害のあるもの）

| ルート | 影響 | 直し方 |
|---|---|---|
| `DELETE /api/admin/courses/[id]` | **他社のシフト・担当コース・単価を削除できる**。`courses` 自体は `.eq("org_id")` で守られていたため、他社のコースは残ったまま中身だけ消える。API は `ok: true` を返す | 関連レコードを消す前に `belongsToOrg("courses", ...)` → 404 |
| `GET /api/admin/driver-ad-hoc-expenses` | **他社の臨時経費（名目と金額）を読める** | `driver_id` を `belongsToOrg` → 404 |
| `POST /api/admin/driver-ad-hoc-expenses` | **他社のドライバーの報酬に経費を足せる** | 同上 |
| `PATCH /api/admin/driver-ad-hoc-expenses/[id]` | **他社の経費の金額を書き換えられる** | 対象行の `driver_id` の所属を確認 → 404 |
| `DELETE /api/admin/driver-ad-hoc-expenses/[id]` | **他社の経費を削除できる** | 同上 |
| `GET /api/admin/driver-expenses` | **他社の固定控除（名目と金額）を読める** | `driver_id` を `belongsToOrg` → 404 |
| `POST /api/admin/driver-expenses` | **他社のドライバーに固定控除を足せる** | 同上 |
| `PATCH` / `DELETE /api/admin/driver-expenses/[id]` | **他社の固定控除の金額を書き換え・削除できる** | 対象行の `driver_id` の所属を確認 → 404 |
| `GET /api/admin/driver-rewards` | **他社のドライバーの経費3表を読める**（自動算出は org 絞りで0になるが、経費は素通り） | `driver_id` を `belongsToOrg` → 404 |
| `GET /api/admin/course-rates` | **全社のコース単価（売上・支払・利益）をそのまま返す**。絞りが一切なく、**対象のUUIDを知る必要すらない** | 自社のコース集合で `.in("course_id", ...)` |
| `PATCH /api/admin/course-rates` | **他社のコース単価を書き換えられる** | `course_id` を `belongsToOrg` → 404 |
| `PUT /api/admin/shift-slots` | **他社の便と便の割当を削除する**（便マスタ `shift_request_slots` は org 列を持たない完全な共有表で、保存が「一覧に無い便を全部消す」「割当を全部消す」を全社横断でやっていた。CASCADE で他社の希望休も消える） | 便の削除は他社が使っていないものに限り、割当の削除・追加は自社のドライバーに限る |

`GET /api/admin/course-rates` は条件が「どこかの会社で単価の閲覧権限を持つ」だけで、
他社のUUIDを知らなくても全社の金額が返る。今回見つかった中では最も条件が緩い。

`PUT /api/admin/shift-slots` は 2026-09-18 時点で**稼働中の会社が1社のみ**のため実害は
出ていないが、2社目を受け入れた時点で必ず壊れる。

### 便の扱いの決定（2026-09-19 ユーザー判断）

**便は共有のままにする。** 元請⇄下請の関係があり、元請が使って便利だと下請に広まる構造に
したいため、他社の便名は見えるほうがよい（将来は承認された関係の範囲に絞る）。

分けるべきは3つで、いま全部が一緒くたになっていた。

| | 変更前 | 変更後 |
|---|---|---|
| 見える | 無条件に全社 | 無条件に全社（将来、承認された関係の範囲へ） |
| 使える（自社ドライバーへ割り当て） | 全社 | 全社（元請の便を下請がそのまま使える） |
| **直す・消す** | **全社の誰でも** | **作った会社だけ** |

migration 179 で `shift_request_slots.owner_org_id` を足し、`saveSlots` を次のようにした。

- 名前・時刻・並び順の変更と削除は **持ち主の会社だけ**
- 他社の便・持ち主不明の便は触らない（画面から消しても残す）
- 新しく作った便には自社を持ち主として入れる
- 割り当ての削除・追加は **自社のドライバーだけ**
- 179 未適用の環境では持ち主が分からないので、退避として「他社のドライバーが使っていない便のみ削除可」へ落ちる

`owner_org_id` が NULL の便（複数社にまたがって使われている・誰も使っていない）は
**どの会社からも編集できない**。本番の3件は割当先から一意に決まるので、適用直後に NULL は残らない。

管理画面では他社の便を読み取り専用（グレー背景＋説明）で並べる。

**次の判断が要るのは「承認された関係の範囲だけに見せる」部分**。`organizations` に会社間の
関係を表す列が1つも無いので、元請⇄下請の関係・申請・承諾を新しく設計する必要がある。
便だけの話に収まらない（単価・車両貸出なども同じ土俵になる）。

経費まわりの4ルートは `requirePermission` のあと **org を一切参照していなかった**
（`user` は権限判定のあと未使用）。金額がそのままペイメント・請求書に効くため影響が大きい。

いずれも「どこかの会社で該当権限を持つ」＋「対象のUUIDを知っている」が条件。

## 実害には至らないが直したもの

- `POST /api/admin/daily/reports/proxy` — ドライバーの所属確認より **前に**他社のシフトを1度読んでいた（応答には出ない）。確認を前に移した。
- 日報の日別・期間集計、要対応バッジ、取込の既存割当チェック、請求先の推定 — シフトを **org で絞らずに全件読み**、アプリ側で自社分だけ使っていた。応答は正しいが、PostgREST の1000行上限で黙って切られると自社の行が欠ける（2026-08-02 の「休み」誤表示と同型）。自社の driver / course 集合で絞るようにした。
- `GET /api/admin/invoice-principal` — 「シフトを全件読む→自社コースで絞る」順序だったのを逆にした。絞り込み結果が変わらないよう、候補は期間内に使われたコースだけに限定し、シフト0件のときは従来どおり null を返す。

## 追加した migration（いずれも未適用）

| # | 対象 | 親 |
|---|---|---|
| 174 | `shift_requests` / `shift_request_logs` | drivers |
| 175 | `shifts` | courses（会社の決定元）＋ drivers（他社割当の禁止） |
| 176 | `driver_ad_hoc_expenses` / `driver_fixed_expenses` / `driver_optional_expenses` / `driver_leases` | drivers |
| 177 | `report_entries` / `daily_reports` | daily_reports_v2 / drivers |
| 178 | `course_rates` / `course_unit_rates` / `course_fixed_rates` / `course_fixed_rate_bundles` / `course_cycles` / `course_report_fields` / `driver_courses` / `driver_request_slots` / `driver_vehicle_preferences` | courses / drivers |
| 179 | `shift_request_slots.owner_org_id`（**所有者のみ。共有は維持**） | — |

`driver_courses` だけは親が2つ（drivers と courses）。両方に複合外部キーを張ったので、
**他社のコースを自社ドライバーの担当にする**こともDBレベルで不可能になる。

共通の方針:

- `org_id` は **NULL 許容**で足す。NOT NULL は全書き込み経路が値を入れていると確認してから別 migration で。
- 複合外部キー `(org_id, 親_id) → 親(org_id, id)` で、行の org と親の所属が食い違えないようにする。
- 参照アクションは **既存の単独FKと同じ挙動にそろえる**。`shifts.driver_id` は `ON DELETE SET NULL` なので、複合側は PG15 以降の列指定形 `ON DELETE SET NULL (driver_id)` にする（列を指定しないと `org_id` まで NULL になる）。`ON UPDATE CASCADE` が無いと所属変更が子の行に阻まれて失敗する。
- 175 では **他社のドライバーをシフトに割り当てることがDBレベルで不可能**になる（2026-09-18 時点で違反行0件を本番で確認済み）。

### 適用順に依存しないこと

migration を適用する前にコードが出ても書き込みが落ちないよう、`server/db/orgColumn.ts` に
退避経路を置いた。`org_id` 列が無いことだけが原因のエラー（42703 / PGRST204）なら
`org_id` を落として書き直す。対象の migration が全環境に入りきったら消してよい。

## 読み取りに `.eq("org_id")` を足していない理由

検出された箇所の多くは、すでに **org 絞りより狭い条件**で固定されている。

- 本人の `driver_id`（`user.driverId`）に固定 — org 全体より狭い
- `belongsToOrg` を通したあとのID
- 自社の `drivers` / `courses` から作った `driverIds` / `courseIds`

これらを `.eq("org_id", orgId)` に置き換えると防御が**弱くなる**。そのため
`// tenant-scope-ok: 理由` で実際の絞りを明示する形にした。理由の書けない箇所は
絞りを足すか、所属確認を追加している。

## 残り

- 検査対象は 57表 → **73表**。org 列が無い表は残り約28表。
- 未着手: 車両まわり5表（`vehicle_loans` / `vehicle_drivers` / `vehicle_recovery_entries` / `vehicle_recovery_collected` / `vehicle_inspection_photos`）、通知3表（`notification_deliveries` / `push_subscriptions` / `line_link_codes`）、チーム戦3表、締切ルール3表、`units` / `unit_fields` / `role_capabilities` / `spot_job_members` / `counterparty_monthly_merged_line_sources`。
- `identities` / `driver_identities` / `passkey_credentials` / `organizations` / `platform_admins` は**設計上テナント横断**（1人が複数社に所属しうる）なので、org 列を足す対象ではない。`carriers` / `shift_request_slots` / `rate_master` / `sales_log_types` は共有マスタ。**このうち `shift_request_slots` だけは会社ごとに持つべきか要判断**（上記）。
- 174〜178 を適用したあと、`org_id IS NULL` の行が増えていなければ NOT NULL を入れられる。
- `server/aggregation/load.ts` は単価3表を全件読んでいたのを自社コース絞りに変えた（往復回数は同じ）。178 適用後は `.eq("org_id", orgId)` に単純化できる。
