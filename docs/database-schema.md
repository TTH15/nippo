# データベーススキーマ

migrations 001〜098 を適用した後の最終状態。

> **マルチテナント移行 Phase 0/1/3（082, 083, 086）**: `companies` を `organizations` へ昇格（`join_code`/`status` 追加、`id`=org_id）。多数のテーブルに `org_id`（車両は `owner_org_id`）を追加し既存全行を ACE テナントへバックフィル → 086 で NOT NULL＋FK 化。スコープ強制は API 層（`server/db/tenant.ts`）。詳細は `platform-design.md` §6,§7。

> **Phase 4（087）**: `company_carriers(org_id, carrier_id)` 追加＝キャリアは共有マスタ＋会社別有効化。

> **Phase 5a 識別子層（088）**: `identities`（人＝顔/免許/氏名/電話/Passkey、1人1つ）と `passkey_credentials` を新設。`drivers` を membership として温存し `drivers.identity_id` で紐付け。`drivers.status`（pending/active/rejected）追加。※ `identities`（人）は既存 `driver_identities`（勤務区分slot）とは別物。

> **本登録 KYC / 2段階承認（089, 090）**: 089=非公開 Storage バケット `kyc-documents`（免許/顔写真）。090=`drivers.kyc_verified_at`/`kyc_verified_by`（運営の本人確認＝本承認）。フロー: 仮登録(電話OTP)→仮承認(pending→active)→本登録(免許/顔/住所/銀行)→本承認(kyc_verified_at)→稼働。詳細は `platform-design.md` §2,§7・memory `tenant-migration`。

> **JWT（6a）**: トークンに `identity_id`＋`current_org_id` を後方互換で追加（`server/auth`）。

---

## ENUM / CHECK 定義

カスタム ENUM 型は使用していない。すべて `CHECK` 制約で値を制限している。

主な値集合：
- `drivers.role` — `'DRIVER' | 'ADMIN' | 'ADMIN_VIEWER'`
- `courses.carrier` — `'YAMATO' | 'AMAZON' | 'OTHER'`
- `daily_reports.carrier` — `'YAMATO' | 'AMAZON'`
- `driver_leases.mode` — `'MONTHLY' | 'DAILY'`
- `report_kinds.capability` — `'none' | 'oil_mileage' | 'expense'`
- `report_kinds.vehicle_mode` — `'required' | 'optional' | 'none'`
- `invoice_documents.status` — `'draft' | 'pending_approval' | 'approved' | 'paid'`
- `events.status` — `'draft' | 'active' | 'closed'`
- `submit_screen_config.ranking_source` — `'auto' | 'event' | 'individual' | 'none'`
- `units.billing_type` — `'PER_PIECE' | 'FIXED'`
- `unit_fields.input_type` — `'INT' | 'TEXT' | 'TIME' | 'BOOL'`

---

## テーブル一覧（アルファベット順）

### carriers
キャリア（運送会社）マスタ。

| カラム | 型 | 制約 |
|--------|-----|------|
| id | uuid | PK, DEFAULT gen_random_uuid() |
| name | text | NOT NULL, UNIQUE |
| code | text | UNIQUE, nullable |
| sort_order | int | NOT NULL, DEFAULT 0 |
| active | boolean | NOT NULL, DEFAULT true |
| created_at | timestamptz | NOT NULL, DEFAULT now() |

---

### company_carriers
キャリアの会社別有効化（087）。carriers は共有マスタのまま、どの org がどのキャリアを使うかを表す。未設定の org は「全 carrier 有効」とフォールバック（`loadOrgCarrierIds` が null→全許可）。

| カラム | 型 | 制約 |
|--------|-----|------|
| org_id | uuid | NOT NULL, FK → organizations(id) |
| carrier_id | uuid | NOT NULL, FK → carriers(id) |
| created_at | timestamptz | NOT NULL, DEFAULT now() |
| PK | | (org_id, carrier_id) |

---

### organizations
テナント（運営会社）マスタ。`id` がテナント内部キー（org_id）。旧 `companies`（082 でリネーム）。

| カラム | 型 | 制約 |
|--------|-----|------|
| id | uuid | PK, DEFAULT gen_random_uuid() |
| code | text | NOT NULL, UNIQUE（表示用の会社コード=旧 company_code） |
| name | text | NOT NULL |
| join_code | text | nullable, UNIQUE(部分: NOT NULL のみ)。参加用招待コード・再生成可 |
| status | text | NOT NULL, DEFAULT 'active'（pending/active/suspended） |
| admin_pin_hash | text | nullable |
| created_at | timestamptz | NOT NULL, DEFAULT now() |

各テーブルの `org_id`（車両は `owner_org_id`）はこの `organizations.id` を指す（FK は Phase 3 で付与）。

---

### counterparty_monthly_custom_lines
取引先月次請求のカスタム明細行。

| カラム | 型 | 制約 |
|--------|-----|------|
| id | uuid | PK |
| company_code | text | NOT NULL |
| invoice_address_id | uuid | NOT NULL, FK → invoice_addresses(id) ON DELETE CASCADE |
| month_yyyy_mm | text | NOT NULL, CHECK `^\d{4}-\d{2}$` |
| sort_order | int | NOT NULL, DEFAULT 0 |
| description | text | NOT NULL, DEFAULT '' |
| quantity | numeric | NOT NULL, DEFAULT 1 |
| unit_price | numeric | NOT NULL, DEFAULT 0 |
| row_kind | text | NOT NULL, DEFAULT 'main', CHECK IN ('main','deduction') |
| created_at | timestamptz | NOT NULL, DEFAULT now() |

**Index:** `idx_cp_custom_lines_lookup (company_code, invoice_address_id, month_yyyy_mm)`

---

### counterparty_monthly_line_labels
取引先月次請求の行ラベル上書き。

| カラム | 型 | 制約 |
|--------|-----|------|
| id | uuid | PK |
| company_code | text | NOT NULL |
| invoice_address_id | uuid | NOT NULL, FK → invoice_addresses(id) ON DELETE CASCADE |
| month_yyyy_mm | text | NOT NULL, CHECK `^\d{4}-\d{2}$` |
| line_key | text | NOT NULL |
| display_label | text | NOT NULL, DEFAULT '' |
| updated_at | timestamptz | NOT NULL, DEFAULT now() |
| UNIQUE | | (company_code, invoice_address_id, month_yyyy_mm, line_key) |

**Index:** `idx_cp_line_labels_lookup`

---

### counterparty_monthly_merged_lines
取引先月次請求の統合明細行。

| カラム | 型 | 制約 |
|--------|-----|------|
| id | uuid | PK |
| company_code | text | NOT NULL |
| invoice_address_id | uuid | NOT NULL, FK → invoice_addresses(id) ON DELETE CASCADE |
| month_yyyy_mm | text | NOT NULL |
| sort_order | int | NOT NULL, DEFAULT 0 |
| description | text | NOT NULL, DEFAULT '' |
| quantity | numeric | NOT NULL, DEFAULT 1 |
| unit_price | numeric | NOT NULL, DEFAULT 0 |
| created_at | timestamptz | NOT NULL, DEFAULT now() |

---

### counterparty_monthly_merged_line_sources
統合明細行のソース行対応。

| カラム | 型 | 制約 |
|--------|-----|------|
| merged_line_id | uuid | PK(複合), FK → counterparty_monthly_merged_lines(id) ON DELETE CASCADE |
| source_line_key | text | PK(複合) |

---

### course_fixed_rates
コース固定単価（キャリア単価制ではなく固定額）。

| カラム | 型 | 制約 |
|--------|-----|------|
| course_id | uuid | PK, FK → courses(id) ON DELETE CASCADE |
| fixed_revenue | int | NOT NULL, DEFAULT 0 |
| fixed_profit | int | NOT NULL, DEFAULT 0 |
| fixed_payout | int | NOT NULL, DEFAULT 0 |
| updated_at | timestamptz | NOT NULL, DEFAULT now() |

---

### course_rates
コース旧単価（YAMATO宅急便・ネコポス用レガシー）。

| カラム | 型 | 制約 |
|--------|-----|------|
| id | uuid | PK |
| course_id | uuid | NOT NULL, UNIQUE, FK → courses(id) ON DELETE CASCADE |
| takuhaibin_revenue | int | DEFAULT 160 |
| takuhaibin_profit | int | DEFAULT 10 |
| takuhaibin_driver_payout | int | DEFAULT 150 |
| nekopos_revenue | int | DEFAULT 40 |
| nekopos_profit | int | DEFAULT 10 |
| nekopos_driver_payout | int | DEFAULT 30 |
| fixed_revenue | int | DEFAULT 0 |
| fixed_profit | int | DEFAULT 0 |
| updated_at | timestamptz | NOT NULL, DEFAULT now() |

---

### course_unit_rates
コース×ユニット単価（新集計体系）。

| カラム | 型 | 制約 |
|--------|-----|------|
| id | uuid | PK |
| course_id | uuid | NOT NULL, FK → courses(id) ON DELETE CASCADE |
| unit_id | uuid | NOT NULL, FK → units(id) ON DELETE CASCADE |
| revenue_per_unit | int | NOT NULL, DEFAULT 0 |
| profit_per_unit | int | NOT NULL, DEFAULT 0 |
| payout_per_unit | int | NOT NULL, DEFAULT 0 |
| fixed_revenue | int | NOT NULL, DEFAULT 0 |
| fixed_profit | int | NOT NULL, DEFAULT 0 |
| fixed_payout | int | NOT NULL, DEFAULT 0 |
| updated_at | timestamptz | NOT NULL, DEFAULT now() |
| UNIQUE | | (course_id, unit_id) |

---

### courses
コース（配送ルート）マスタ。

| カラム | 型 | 制約 |
|--------|-----|------|
| id | uuid | PK |
| name | text | NOT NULL, UNIQUE |
| color | text | NOT NULL, DEFAULT '#3b82f6' |
| sort_order | int | NOT NULL, DEFAULT 0 |
| created_at | timestamptz | NOT NULL, DEFAULT now() |
| max_drivers | int | NOT NULL, DEFAULT 1 |
| carrier | text | DEFAULT 'OTHER', CHECK IN ('YAMATO','AMAZON','OTHER') |
| summary_title | text | nullable |
| principal_invoice_address_id | uuid | nullable |
| counterparty_invoice_address_id | uuid | nullable |
| carrier_id | uuid | nullable, FK → carriers(id) ON DELETE SET NULL |
| daily_lease | int | NOT NULL, DEFAULT 0 |

---

### daily_reports
日報（YAMATO・Amazon、レガシー）。

| カラム | 型 | 制約 |
|--------|-----|------|
| id | uuid | PK |
| driver_id | uuid | NOT NULL, FK → drivers(id) ON DELETE CASCADE |
| report_date | date | NOT NULL |
| takuhaibin_completed | int | NOT NULL, DEFAULT 0 |
| takuhaibin_returned | int | NOT NULL, DEFAULT 0 |
| nekopos_completed | int | NOT NULL, DEFAULT 0 |
| nekopos_returned | int | NOT NULL, DEFAULT 0 |
| submitted_at | timestamptz | NOT NULL, DEFAULT now() |
| vehicle_id | uuid | nullable, FK → vehicles(id) ON DELETE SET NULL |
| meter_value | int | nullable |
| carrier | text | NOT NULL, DEFAULT 'YAMATO', CHECK IN ('YAMATO','AMAZON') |
| approved_at | timestamptz | nullable |
| approved_by | uuid | nullable, FK → drivers(id) ON DELETE SET NULL |
| rejected_at | timestamptz | nullable |
| rejected_by | uuid | nullable, FK → drivers(id) ON DELETE SET NULL |
| amazon_am_mochidashi | int | NOT NULL, DEFAULT 0 |
| amazon_am_completed | int | NOT NULL, DEFAULT 0 |
| amazon_pm_mochidashi | int | NOT NULL, DEFAULT 0 |
| amazon_pm_completed | int | NOT NULL, DEFAULT 0 |
| amazon_4_mochidashi | int | NOT NULL, DEFAULT 0 |
| amazon_4_completed | int | NOT NULL, DEFAULT 0 |
| driver_identity_id | uuid | nullable, FK → driver_identities(id) ON DELETE CASCADE |

**UNIQUE:** `(driver_identity_id, report_date) WHERE rejected_at IS NULL`

---

### daily_reports_v2
日報（新集計体系）。

| カラム | 型 | 制約 |
|--------|-----|------|
| id | uuid | PK |
| driver_id | uuid | NOT NULL, FK → drivers(id) ON DELETE CASCADE |
| report_date | date | NOT NULL |
| course_id | uuid | nullable, FK → courses(id) ON DELETE SET NULL |
| carrier_id | uuid | nullable, FK → carriers(id) ON DELETE SET NULL |
| identity_id | uuid | nullable, FK → driver_identities(id) ON DELETE SET NULL |
| vehicle_id | uuid | nullable, FK → vehicles(id) ON DELETE SET NULL |
| meter_value | int | nullable |
| submitted_at | timestamptz | NOT NULL, DEFAULT now() |
| approved_at | timestamptz | nullable |
| approved_by | uuid | nullable, FK → drivers(id) ON DELETE SET NULL |
| rejected_at | timestamptz | nullable |
| rejected_by | uuid | nullable, FK → drivers(id) ON DELETE SET NULL |
| legacy_report_id | uuid | nullable, FK → daily_reports(id) ON DELETE SET NULL |

**UNIQUE（部分）:**
- `(driver_id, report_date, course_id, identity_id) WHERE identity_id IS NOT NULL AND rejected_at IS NULL`
- `(driver_id, report_date, course_id) WHERE identity_id IS NULL AND rejected_at IS NULL`

---

### driver_ad_hoc_expenses
ドライバー臨時費用（都度入力）。

| カラム | 型 | 制約 |
|--------|-----|------|
| id | uuid | PK |
| driver_id | uuid | NOT NULL, FK → drivers(id) ON DELETE CASCADE |
| month | text | NOT NULL |
| name | text | NOT NULL |
| amount | int | NOT NULL |
| created_at | timestamptz | NOT NULL, DEFAULT now() |
| updated_at | timestamptz | NOT NULL, DEFAULT now() |
| sales_log_entry_id | uuid | nullable, UNIQUE WHERE NOT NULL, FK → sales_log_entries(id) ON DELETE CASCADE |
| misc_report_id | uuid | nullable, UNIQUE WHERE NOT NULL, FK → oil_change_reports(id) ON DELETE CASCADE |

---

### driver_courses
ドライバー×コース紐付け（identity 単位）。

| カラム | 型 | 制約 |
|--------|-----|------|
| id | uuid | PK |
| driver_id | uuid | NOT NULL, FK → drivers(id) ON DELETE CASCADE |
| course_id | uuid | NOT NULL, FK → courses(id) ON DELETE CASCADE |
| created_at | timestamptz | NOT NULL, DEFAULT now() |
| driver_identity_id | uuid | NOT NULL, FK → driver_identities(id) ON DELETE CASCADE |
| UNIQUE | | (driver_identity_id, course_id) |

---

### driver_fixed_expenses
ドライバー固定費（月次）。

| カラム | 型 | 制約 |
|--------|-----|------|
| id | uuid | PK |
| driver_id | uuid | NOT NULL, FK → drivers(id) ON DELETE CASCADE |
| name | text | NOT NULL |
| amount | int | NOT NULL |
| cycle | text | NOT NULL, DEFAULT 'MONTHLY', CHECK IN ('MONTHLY') |
| valid_from | date | NOT NULL, DEFAULT 月初 |
| valid_to | date | nullable |
| created_at | timestamptz | NOT NULL, DEFAULT now() |
| updated_at | timestamptz | NOT NULL, DEFAULT now() |

---

### driver_identities
ドライバーの「コード」単位 identity（最大2スロット）。

| カラム | 型 | 制約 |
|--------|-----|------|
| id | uuid | PK |
| driver_id | uuid | NOT NULL, FK → drivers(id) ON DELETE CASCADE |
| slot | smallint | NOT NULL, CHECK IN (1, 2) |
| driver_code | text | NOT NULL, UNIQUE |
| office_code | text | NOT NULL, DEFAULT '' |
| label | text | nullable |
| created_at | timestamptz | NOT NULL, DEFAULT now() |
| UNIQUE | | (driver_id, slot) |

---

### driver_leases
ドライバーリース費（月額 or 日額）。

| カラム | 型 | 制約 |
|--------|-----|------|
| id | uuid | PK |
| driver_id | uuid | NOT NULL, FK → drivers(id) ON DELETE CASCADE |
| mode | text | NOT NULL, CHECK IN ('MONTHLY','DAILY') |
| amount | int | NOT NULL, CHECK >= 0 |
| valid_from | date | NOT NULL, DEFAULT 月初 |
| valid_to | date | nullable |
| created_at | timestamptz | NOT NULL, DEFAULT now() |
| updated_at | timestamptz | NOT NULL, DEFAULT now() |

---

### driver_optional_expenses
ドライバー任意費用（月次）。

| カラム | 型 | 制約 |
|--------|-----|------|
| id | uuid | PK |
| driver_id | uuid | NOT NULL, FK → drivers(id) ON DELETE CASCADE |
| month | text | NOT NULL |
| name | text | NOT NULL |
| amount | int | NOT NULL |
| created_at | timestamptz | NOT NULL, DEFAULT now() |
| updated_at | timestamptz | NOT NULL, DEFAULT now() |

---

### driver_vehicle_preferences
ドライバー優先使用車両。

| カラム | 型 | 制約 |
|--------|-----|------|
| driver_id | uuid | PK, FK → drivers(id) ON DELETE CASCADE |
| vehicle_id | uuid | NOT NULL, FK → vehicles(id) ON DELETE CASCADE |
| updated_at | timestamptz | NOT NULL, DEFAULT now() |

---

### drivers
ドライバー（＋管理者）マスタ。

| カラム | 型 | 制約 |
|--------|-----|------|
| id | uuid | PK |
| name | text | NOT NULL |
| line_user_id | text | UNIQUE, nullable |
| role | text | NOT NULL, CHECK IN ('DRIVER','ADMIN','ADMIN_VIEWER') |
| pin_hash | text | nullable |
| created_at | timestamptz | NOT NULL, DEFAULT now() |
| company_code | text | nullable |
| office_code | text | nullable |
| driver_code | text | nullable（非 UNIQUE、identity へ移行済） |
| display_name | text | nullable |
| postal_code | text | nullable |
| address | text | nullable |
| phone | text | nullable |
| bank_name | text | nullable |
| bank_no | text | nullable |
| bank_holder | text | nullable |
| list_no | integer | nullable |
| license_expiry_date | date | nullable |
| last_bonus_seen_at | timestamptz | nullable |
| org_id | uuid | NOT NULL, FK → organizations(id)（083/086） |
| identity_id | uuid | nullable, FK → identities(id)（088。membership↔人の紐付け） |
| status | text | NOT NULL, DEFAULT 'active', CHECK IN ('pending','active','rejected')（088。仮承認の状態） |
| kyc_verified_at | timestamptz | nullable（090。運営の本人確認＝本承認の時刻。null=本承認前） |
| kyc_verified_by | uuid | nullable（090。本承認した運営の driver id） |

**ドライバーの状態（2段階承認）:** `status='pending'`=仮登録申請中 / `status='active' かつ kyc_verified_at IS NULL`=仮承認済・本登録/本人確認待ち / `status='active' かつ kyc_verified_at IS NOT NULL`=本承認済（稼働可）/ `status='rejected'`=却下。**住所/銀行（postal_code/address/bank_*）は membership（drivers）側、氏名/免許/顔写真は identity 側**（本名 vs 表示名 display_name）。

**Index:** `idx_drivers_company_list_no_driver (company_code, list_no) WHERE role = 'DRIVER' AND list_no IS NOT NULL`、`idx_drivers_identity_id`

---

### identities
人（KYC・認証）の層（088）。**1人=1つ（グローバル）**。`drivers`（membership）が `identity_id` で紐付く。検証済み電話で重複排除（仮登録 find-or-create）。※既存 `driver_identities`（勤務区分slot）とは別物・混同注意。

| カラム | 型 | 制約 |
|--------|-----|------|
| id | uuid | PK, DEFAULT gen_random_uuid() |
| name | text | nullable（本名） |
| dob | date | nullable（生年月日） |
| phone | text | nullable |
| phone_verified_at | timestamptz | nullable（SMS OTP 検証時刻。仮登録で刻む） |
| face_photo_path | text | nullable（非公開バケット kyc-documents のパス） |
| license_photo_path | text | nullable（同上） |
| license_expiry | date | nullable（免許有効期限。OCR/手入力） |
| line_user_id | text | UNIQUE, nullable |
| pin_hash | text | nullable（Phase 6 で Passkey に置換予定の橋渡し） |
| created_at | timestamptz | NOT NULL, DEFAULT now() |

---

### passkey_credentials
WebAuthn 資格情報（088・Phase 6 で使用、現状は空）。

| カラム | 型 | 制約 |
|--------|-----|------|
| id | uuid | PK, DEFAULT gen_random_uuid() |
| identity_id | uuid | NOT NULL, FK → identities(id) |
| credential_id | text | UNIQUE, nullable |
| public_key | bytea | nullable |
| counter | bigint | nullable |
| created_at | timestamptz | NOT NULL, DEFAULT now() |

---

### event_point_entries
イベントポイント履歴。

| カラム | 型 | 制約 |
|--------|-----|------|
| id | uuid | PK |
| event_id | uuid | NOT NULL, FK → events(id) ON DELETE CASCADE |
| team_id | uuid | nullable, FK → event_teams(id) ON DELETE SET NULL |
| driver_id | uuid | nullable, FK → drivers(id) ON DELETE SET NULL |
| entry_date | date | nullable |
| points | numeric | NOT NULL, DEFAULT 0 |
| reason | text | nullable |
| source | text | NOT NULL, DEFAULT 'manual', CHECK IN ('manual','auto') |
| created_at | timestamptz | NOT NULL, DEFAULT now() |

---

### event_team_members
イベントチームメンバー。

| カラム | 型 | 制約 |
|--------|-----|------|
| id | uuid | PK |
| event_id | uuid | NOT NULL, FK → events(id) ON DELETE CASCADE |
| team_id | uuid | NOT NULL, FK → event_teams(id) ON DELETE CASCADE |
| driver_id | uuid | NOT NULL, FK → drivers(id) ON DELETE CASCADE |
| created_at | timestamptz | NOT NULL, DEFAULT now() |
| UNIQUE | | (event_id, driver_id) |

---

### event_teams
イベントチーム。

| カラム | 型 | 制約 |
|--------|-----|------|
| id | uuid | PK |
| event_id | uuid | NOT NULL, FK → events(id) ON DELETE CASCADE |
| name | text | NOT NULL |
| color | text | NOT NULL, DEFAULT '#3b82f6' |
| sort_order | int | NOT NULL, DEFAULT 0 |
| created_at | timestamptz | NOT NULL, DEFAULT now() |

---

### events
ゲーミフィケーションイベント。

| カラム | 型 | 制約 |
|--------|-----|------|
| id | uuid | PK |
| name | text | NOT NULL |
| description | text | NOT NULL, DEFAULT '' |
| starts_on | date | nullable |
| ends_on | date | nullable |
| status | text | NOT NULL, DEFAULT 'draft', CHECK IN ('draft','active','closed') |
| scoring_rule | jsonb | NOT NULL, DEFAULT '{}' |
| created_at | timestamptz | NOT NULL, DEFAULT now() |
| team_ranking_visible_to_drivers | boolean | NOT NULL, DEFAULT false |

---

### invoice_addresses
請求先住所（取引先）マスタ。

| カラム | 型 | 制約 |
|--------|-----|------|
| id | uuid | PK |
| company_code | text | NOT NULL |
| name | text | NOT NULL |
| postal_code | text | nullable |
| address | text | nullable |
| phone | text | nullable |
| invoice_no | text | nullable |
| created_at | timestamptz | NOT NULL, DEFAULT now() |
| billing_notes | text | nullable |

---

### invoice_documents
請求書ドキュメント。

| カラム | 型 | 制約 |
|--------|-----|------|
| id | uuid | PK |
| company_code | text | NOT NULL |
| month_yyyy_mm | text | NOT NULL, CHECK `^\d{4}-\d{2}$` |
| section | text | NOT NULL, CHECK IN ('Amazon','ヤマト運輸','郵便局') |
| counterparty_invoice_address_id | uuid | nullable, FK → invoice_addresses(id) ON DELETE SET NULL |
| client_name | text | NOT NULL, DEFAULT '' |
| issue_date | date | nullable |
| invoice_no | text | nullable |
| amount | numeric | NOT NULL, DEFAULT 0 |
| status | text | NOT NULL, DEFAULT 'draft', CHECK IN ('draft','pending_approval','approved','paid') |
| payload | jsonb | NOT NULL, DEFAULT '{}' |
| created_at | timestamptz | NOT NULL, DEFAULT now() |
| updated_at | timestamptz | NOT NULL, DEFAULT now() |
| driver_id | uuid | nullable, FK → drivers(id) ON DELETE SET NULL |
| is_starred | boolean | NOT NULL, DEFAULT false |

**特殊制約:** `payload.parties.toParty = 'ace_creation'` かつ fromParty が `drv-` 始まりの場合は `driver_id` が必須。

---

### ledger_entries
台帳エントリ（新集計体系の収支レコード）。

| カラム | 型 | 制約 |
|--------|-----|------|
| id | uuid | PK |
| entry_date | date | NOT NULL |
| type_id | uuid | nullable, FK → sales_log_types(id) ON DELETE SET NULL |
| content | text | NOT NULL, DEFAULT '' |
| revenue_delta | int | NOT NULL, DEFAULT 0 |
| profit_delta | int | NOT NULL, DEFAULT 0 |
| payout_delta | int | NOT NULL, DEFAULT 0 |
| target_driver_id | uuid | nullable, FK → drivers(id) ON DELETE SET NULL |
| course_id | uuid | nullable, FK → courses(id) ON DELETE SET NULL |
| counterparty_invoice_address_id | uuid | nullable, FK → invoice_addresses(id) ON DELETE SET NULL |
| legacy_sales_log_id | uuid | nullable, UNIQUE WHERE NOT NULL |
| legacy_ad_hoc_expense_id | uuid | nullable, UNIQUE WHERE NOT NULL |
| created_at | timestamptz | NOT NULL, DEFAULT now() |

---

### oil_change_reports
諸報告（オイル交換・修理・精算等）。`report_kind` で種別を切り替え。

| カラム | 型 | 制約 |
|--------|-----|------|
| id | uuid | PK |
| driver_id | uuid | NOT NULL, FK → drivers(id) ON DELETE CASCADE |
| report_date | date | NOT NULL |
| report_time | time | NOT NULL |
| occurred_at | timestamptz | NOT NULL |
| location | text | NOT NULL |
| odometer_km | integer | nullable, CHECK >= 0 |
| submitted_at | timestamptz | NOT NULL, DEFAULT now() |
| approved_at | timestamptz | nullable |
| approved_by | uuid | nullable, FK → drivers(id) ON DELETE SET NULL |
| rejected_at | timestamptz | nullable |
| rejected_by | uuid | nullable, FK → drivers(id) ON DELETE SET NULL |
| created_at | timestamptz | NOT NULL, DEFAULT now() |
| updated_at | timestamptz | NOT NULL, DEFAULT now() |
| vehicle_id | uuid | nullable, FK → vehicles(id) ON DELETE SET NULL |
| report_kind | text | NOT NULL, DEFAULT 'oil_change' |
| description | text | NOT NULL, DEFAULT '' |
| expense_amount | integer | nullable |
| answers | jsonb | NOT NULL, DEFAULT '{}' |
| attachments | jsonb | NOT NULL, DEFAULT '[]' |

---

### payrolls
給与計算（Draft→Confirmed→Paid）。

| カラム | 型 | 制約 |
|--------|-----|------|
| id | uuid | PK |
| driver_id | uuid | NOT NULL, FK → drivers(id) ON DELETE CASCADE |
| month | char(7) | NOT NULL |
| total_amount | int | NOT NULL, DEFAULT 0 |
| status | text | NOT NULL, DEFAULT 'DRAFT', CHECK IN ('DRAFT','CONFIRMED','PAID') |
| created_at | timestamptz | NOT NULL, DEFAULT now() |
| UNIQUE | | (driver_id, month) |

---

### rate_master
レートマスタ（TAKUHAIBIN・NEKOPOS 基本単価）。

| カラム | 型 | 制約 |
|--------|-----|------|
| id | uuid | PK |
| kind | text | NOT NULL, CHECK IN ('TAKUHAIBIN','NEKOPOS'), UNIQUE |
| rate_per_completed | int | NOT NULL, DEFAULT 0 |
| updated_at | timestamptz | NOT NULL, DEFAULT now() |

---

### report_entries
日報エントリ明細（v2 日報の unit ごとの数値）。

| カラム | 型 | 制約 |
|--------|-----|------|
| id | uuid | PK |
| report_id | uuid | NOT NULL, FK → daily_reports_v2(id) ON DELETE CASCADE |
| unit_id | uuid | NOT NULL, FK → units(id) ON DELETE CASCADE |
| field_key | text | NOT NULL |
| value_num | numeric | nullable |
| value_text | text | nullable |
| created_at | timestamptz | NOT NULL, DEFAULT now() |
| UNIQUE | | (report_id, unit_id, field_key) |

---

### report_kinds
諸報告の種別マスタ（フォームビルダー対応）。

| カラム | 型 | 制約 |
|--------|-----|------|
| id | uuid | PK |
| key | text | NOT NULL, UNIQUE |
| label | text | NOT NULL |
| sort_order | int | NOT NULL, DEFAULT 0 |
| is_active | boolean | NOT NULL, DEFAULT true |
| uses_location | boolean | NOT NULL, DEFAULT true |
| uses_odometer | boolean | NOT NULL, DEFAULT false |
| uses_description | boolean | NOT NULL, DEFAULT true |
| uses_amount | boolean | NOT NULL, DEFAULT false |
| description_required | boolean | NOT NULL, DEFAULT true |
| description_label | text | nullable |
| capability | text | NOT NULL, DEFAULT 'none', CHECK IN ('none','oil_mileage','expense') |
| created_at | timestamptz | NOT NULL, DEFAULT now() |
| updated_at | timestamptz | NOT NULL, DEFAULT now() |
| uses_vehicle | boolean | NOT NULL, DEFAULT true |
| fields | jsonb | NOT NULL, DEFAULT '[]' （カスタムフォームフィールド定義） |
| vehicle_mode | text | NOT NULL, DEFAULT 'required', CHECK IN ('required','optional','none') |

---

### sales_log_entries
売上ログ（レガシー収支記録）。

| カラム | 型 | 制約 |
|--------|-----|------|
| id | uuid | PK |
| log_date | date | NOT NULL |
| type_id | uuid | NOT NULL, FK → sales_log_types(id) ON DELETE RESTRICT |
| content | text | NOT NULL |
| amount | int | NOT NULL |
| attribution | text | NOT NULL, DEFAULT 'COMPANY', CHECK IN ('COMPANY','DRIVER') |
| target_driver_id | uuid | nullable, FK → drivers(id) ON DELETE SET NULL |
| vehicle_id | uuid | nullable, FK → vehicles(id) ON DELETE SET NULL |
| memo | text | nullable |
| created_at | timestamptz | NOT NULL, DEFAULT now() |
| updated_at | timestamptz | NOT NULL, DEFAULT now() |
| revenue | int | NOT NULL, DEFAULT 0 |
| profit | int | NOT NULL, DEFAULT 0 |
| counterparty_invoice_address_id | uuid | nullable, FK → invoice_addresses(id) ON DELETE SET NULL |

---

### sales_log_types
売上ログ種別マスタ。

| カラム | 型 | 制約 |
|--------|-----|------|
| id | uuid | PK |
| name | text | NOT NULL, UNIQUE |
| sort_order | int | NOT NULL, DEFAULT 0 |
| created_at | timestamptz | NOT NULL, DEFAULT now() |

---

### shift_request_deadline_config
シフト希望締切設定。

| カラム | 型 | 制約 |
|--------|-----|------|
| id | uuid | PK |
| first_half_end_day | int | NOT NULL, DEFAULT 15 |
| first_half_deadline_month_offset | int | NOT NULL, DEFAULT -1 |
| first_half_deadline_day | int | NOT NULL, DEFAULT 23 |
| second_half_deadline_month_offset | int | NOT NULL, DEFAULT 0 |
| second_half_deadline_day | int | NOT NULL, DEFAULT 10 |
| updated_at | timestamptz | NOT NULL, DEFAULT now() |

---

### shift_request_deadline_overrides
シフト希望締切の個別上書き。

| カラム | 型 | 制約 |
|--------|-----|------|
| id | uuid | PK |
| target_year | int | NOT NULL |
| target_month | int | NOT NULL |
| half | text | NOT NULL, CHECK IN ('FIRST','SECOND') |
| deadline_date | date | NOT NULL |
| note | text | nullable |
| updated_at | timestamptz | NOT NULL, DEFAULT now() |
| UNIQUE | | (target_year, target_month, half) |

---

### shift_requests
ドライバーのシフト希望（OFF申請）。

| カラム | 型 | 制約 |
|--------|-----|------|
| id | uuid | PK |
| driver_id | uuid | NOT NULL, FK → drivers(id) ON DELETE CASCADE |
| request_date | date | NOT NULL |
| request_type | text | NOT NULL, DEFAULT 'OFF', CHECK IN ('OFF') |
| note | text | nullable |
| created_at | timestamptz | NOT NULL, DEFAULT now() |
| UNIQUE | | (driver_id, request_date) |

---

### shifts
シフト（コース×日付×スロット）。

| カラム | 型 | 制約 |
|--------|-----|------|
| id | uuid | PK |
| shift_date | date | NOT NULL |
| course_id | uuid | NOT NULL, FK → courses(id) ON DELETE CASCADE |
| driver_id | uuid | nullable, FK → drivers(id) ON DELETE SET NULL |
| created_at | timestamptz | NOT NULL, DEFAULT now() |
| updated_at | timestamptz | NOT NULL, DEFAULT now() |
| slot | int | NOT NULL, DEFAULT 1 |
| vehicle_id | uuid | nullable, FK → vehicles(id) ON DELETE SET NULL |
| uses_external_vehicle | boolean | NOT NULL, DEFAULT false |
| UNIQUE | | (shift_date, course_id, slot) |

---

### submit_screen_config
ドライバー提出画面の設定。

| カラム | 型 | 制約 |
|--------|-----|------|
| id | uuid | PK |
| metric_label | text | NOT NULL, DEFAULT '完了個数' |
| metric_fields | jsonb | NOT NULL, DEFAULT '[]' |
| target_driver_ids | jsonb | NOT NULL, DEFAULT '[]' |
| period | text | NOT NULL, DEFAULT 'current_month' |
| show_ranking | boolean | NOT NULL, DEFAULT true |
| updated_at | timestamptz | NOT NULL, DEFAULT now() |
| team_ranking_visible_to_drivers | boolean | NOT NULL, DEFAULT false |
| ranking_source | text | NOT NULL, DEFAULT 'auto', CHECK IN ('auto','event','individual','none') |
| linked_event_id | uuid | nullable, FK → events(id) ON DELETE SET NULL |
| thanks_title | text | NOT NULL, DEFAULT 'お疲れさまでした' |
| thanks_message | text | NOT NULL, DEFAULT '' |
| blocks | jsonb | nullable（ブロック定義 JSON） |

---

### unit_fields
ユニットのフィールド定義。

| カラム | 型 | 制約 |
|--------|-----|------|
| id | uuid | PK |
| unit_id | uuid | NOT NULL, FK → units(id) ON DELETE CASCADE |
| field_key | text | NOT NULL |
| label | text | NOT NULL |
| input_type | text | NOT NULL, CHECK IN ('INT','TEXT','TIME','BOOL') |
| group_label | text | nullable |
| is_billable | boolean | NOT NULL, DEFAULT false |
| required | boolean | NOT NULL, DEFAULT false |
| sort_order | int | NOT NULL, DEFAULT 0 |
| created_at | timestamptz | NOT NULL, DEFAULT now() |
| UNIQUE | | (unit_id, field_key) |

---

### units
キャリア配下の配送ユニット（宅急便・ネコポス・Amazon配送等）。

| カラム | 型 | 制約 |
|--------|-----|------|
| id | uuid | PK |
| carrier_id | uuid | NOT NULL, FK → carriers(id) ON DELETE CASCADE |
| name | text | NOT NULL |
| code | text | nullable |
| billing_type | text | NOT NULL, CHECK IN ('PER_PIECE','FIXED') |
| sort_order | int | NOT NULL, DEFAULT 0 |
| active | boolean | NOT NULL, DEFAULT true |
| created_at | timestamptz | NOT NULL, DEFAULT now() |
| UNIQUE | | (carrier_id, name) |

---

### vehicle_drivers
車両×ドライバー紐付け。

| カラム | 型 | 制約 |
|--------|-----|------|
| id | uuid | PK |
| vehicle_id | uuid | NOT NULL, FK → vehicles(id) ON DELETE CASCADE |
| driver_id | uuid | NOT NULL, FK → drivers(id) ON DELETE CASCADE |
| created_at | timestamptz | NOT NULL, DEFAULT now() |
| UNIQUE | | (vehicle_id, driver_id) |

---

### vehicle_loans
車両貸し出し記録。

| カラム | 型 | 制約 |
|--------|-----|------|
| id | uuid | PK |
| vehicle_id | uuid | NOT NULL, FK → vehicles(id) ON DELETE CASCADE |
| loan_date | date | NOT NULL |
| note | text | nullable |
| borrower_org_id | uuid | nullable, FK → organizations(id)（貸与先org。QRのテナント横断認可に使用。migration 097） |
| created_at | timestamptz | NOT NULL, DEFAULT now() |
| UNIQUE | | (vehicle_id, loan_date) |

---

### vehicle_qr
車両QRのローテーション式トークン（migration 096）。再発行で旧失効・ADMIN貼付確認で有効化。設計: `vehicle-session-flow.md §8`。

| カラム | 型 | 制約 |
|--------|-----|------|
| id | uuid | PK |
| vehicle_id | uuid | NOT NULL, FK → vehicles(id) ON DELETE CASCADE |
| org_id | uuid | NOT NULL, FK → organizations(id)（発行=所有org） |
| token | text | NOT NULL, UNIQUE（不透明。QRペイロード `nippo://v/<token>`） |
| version | int | NOT NULL, DEFAULT 1（再発行で+1） |
| status | text | NOT NULL, DEFAULT 'issued'，CHECK in ('issued','active','revoked') |
| issued_at / issued_by | timestamptz / uuid | 発行時刻・発行membership |
| attached_confirmed_at / attached_confirmed_by | timestamptz / uuid | 貼付確認(有効化) |
| revoked_at | timestamptz | nullable |
| 部分UNIQUE | | (vehicle_id) WHERE status <> 'revoked'（有効トークンは車両に1本） |

---

### vehicle_sessions
車両セッション（出退勤＝勤怠の正本。migration 095）。設計: `vehicle-session-flow.md §1`。

| カラム | 型 | 制約 |
|--------|-----|------|
| id | uuid | PK |
| vehicle_id | uuid | NOT NULL, FK → vehicles(id) |
| org_id | uuid | NOT NULL, FK → organizations(id)（使用org。貸与中は借用org） |
| recorded_by | uuid | FK → drivers(id)（記録ドライバー） |
| purpose | text | NOT NULL, DEFAULT 'work'，CHECK in ('work','move','private') |
| shift_id / authorized_by | uuid | nullable（work紐付け／private承認者） |
| status | text | NOT NULL, DEFAULT 'open'，CHECK in ('open','closed') |
| started_at / start_lat / start_lng / start_odometer | ts / float / float / int | 出勤 |
| ended_at / end_lat / end_lng / end_odometer | ts / float / float / int | 退勤 |
| start_method / end_method | text | 'qr'｜'plate_ocr'｜'manual'（打刻手段） |
| start_gps_status / end_gps_status | text | 'captured'｜'denied'｜'unavailable' |
| fallback_reason / plate_photo_path | text | 退避ルート証跡（plate_ocr/manual時） |
| approval_status / approved_at / approved_by | text / ts / uuid | manual打刻の承認（'pending'｜'approved'｜'rejected'） |
| created_at | timestamptz | NOT NULL, DEFAULT now() |

ドライバー別走行距離は派生（SUM(end_odometer - start_odometer) GROUP BY recorded_by）。

---

### vehicle_inspections
稼働前後の点検（オドメーター＋状態写真。migration 095）。

| カラム | 型 | 制約 |
|--------|-----|------|
| id | uuid | PK |
| session_id | uuid | FK → vehicle_sessions(id) ON DELETE SET NULL |
| vehicle_id | uuid | NOT NULL, FK → vehicles(id) |
| org_id | uuid | NOT NULL, FK → organizations(id) |
| recorded_by | uuid | FK → drivers(id) |
| phase | text | NOT NULL, CHECK in ('pre','post') |
| odometer_reading | int | nullable |
| odometer_photo_path | text | nullable（Storage `meter-photos`。承認まで保持） |
| odometer_photo_retain_until | timestamptz | nullable（cleanup用） |
| created_at | timestamptz | NOT NULL, DEFAULT now() |

---

### vehicle_inspection_photos
点検の角度別写真（migration 095。UI未実装）。

| カラム | 型 | 制約 |
|--------|-----|------|
| id | uuid | PK |
| inspection_id | uuid | NOT NULL, FK → vehicle_inspections(id) ON DELETE CASCADE |
| angle | text | NOT NULL（front/rear/left/right/corner_* 等） |
| photo_path | text | NOT NULL |
| created_at | timestamptz | NOT NULL, DEFAULT now() |

---

### vehicle_recovery_collected
車両回収費の月次入金記録。

| カラム | 型 | 制約 |
|--------|-----|------|
| id | uuid | PK |
| vehicle_id | uuid | NOT NULL, FK → vehicles(id) ON DELETE CASCADE |
| month | int | NOT NULL, CHECK 1 <= month <= 24 |
| collected_at | date | NOT NULL |
| UNIQUE | | (vehicle_id, month) |

---

### vehicle_recovery_entries
車両回収費の月次明細。

| カラム | 型 | 制約 |
|--------|-----|------|
| id | uuid | PK |
| vehicle_id | uuid | NOT NULL, FK → vehicles(id) ON DELETE CASCADE |
| ym | date | NOT NULL |
| lease | int | NOT NULL, DEFAULT 0 |
| insurance | int | NOT NULL, DEFAULT 0 |
| note | text | nullable |
| created_at | timestamptz | NOT NULL, DEFAULT now() |

---

### vehicles
車両マスタ。

| カラム | 型 | 制約 |
|--------|-----|------|
| id | uuid | PK |
| current_mileage | int | NOT NULL, DEFAULT 0 |
| last_oil_change_mileage | int | NOT NULL, DEFAULT 0 |
| oil_change_interval | int | NOT NULL, DEFAULT 3000 |
| created_at | timestamptz | NOT NULL, DEFAULT now() |
| updated_at | timestamptz | NOT NULL, DEFAULT now() |
| number_prefix | text | nullable |
| number_hiragana | text | nullable |
| number_numeric | text | nullable |
| purchase_cost | int | DEFAULT 0 |
| monthly_insurance | int | DEFAULT 0 |
| manufacturer | text | nullable |
| brand | text | nullable |
| number_class | text | nullable |
| next_shaken_date | date | nullable |
| lease_cost | int | DEFAULT 35000 |
| image_url | text | nullable |
| jibaiseki_renewal_month | char(7) | nullable |
| is_disposed | boolean | NOT NULL, DEFAULT false |
| is_ev | boolean | NOT NULL, DEFAULT false |
| purchase_cost_items | jsonb | nullable |
| recovery_start_month | date | nullable |
| recovery_carryover | int | NOT NULL, DEFAULT 0 |

---

## 初期シードデータ

| テーブル | データ |
|---------|--------|
| rate_master | TAKUHAIBIN: 200円/個、NEKOPOS: 70円/個 |
| companies | code=AAA（開発会社） |
| courses | ヤマトA/B/C、Amazonミッドナイト |
| sales_log_types | 売上、外注費、修理費、車両費、単発案件、その他、残業代、最低保証、立替費用、リース代、控除 |
| carriers | ヤマト(YAMATO)、Amazon(AMAZON) |
| units | 宅急便(TAKUHAIBIN)、ネコポス(NEKOPOS)、Amazon配送(AMAZON_DELIVERY) |
| unit_fields | 9フィールド（完了数・持出数×AM/PM/4th等） |
| report_kinds | oil_change、repair、expense、other |

---

## テーブル関連図（主要FK）

```
companies
  └── (company_code参照) → drivers, invoice_addresses

drivers
  ├── driver_identities (1:2スロット)
  │     ├── driver_courses
  │     ├── daily_reports.driver_identity_id
  │     └── daily_reports_v2.identity_id
  ├── shifts.driver_id
  ├── daily_reports.driver_id
  ├── daily_reports_v2.driver_id
  ├── oil_change_reports.driver_id
  ├── driver_fixed_expenses
  ├── driver_optional_expenses
  ├── driver_ad_hoc_expenses
  ├── driver_leases
  ├── driver_vehicle_preferences
  └── payrolls

carriers
  ├── units
  │     ├── unit_fields
  │     ├── course_unit_rates
  │     └── report_entries
  └── courses.carrier_id

courses
  ├── shifts
  ├── course_rates (旧)
  ├── course_unit_rates (新)
  ├── course_fixed_rates
  ├── driver_courses
  ├── daily_reports_v2.course_id
  └── ledger_entries.course_id

vehicles
  ├── shifts.vehicle_id
  ├── daily_reports.vehicle_id
  ├── daily_reports_v2.vehicle_id
  ├── oil_change_reports.vehicle_id
  ├── vehicle_drivers
  ├── vehicle_loans
  ├── vehicle_recovery_collected
  └── vehicle_recovery_entries

invoice_addresses
  ├── counterparty_monthly_custom_lines
  ├── counterparty_monthly_line_labels
  ├── counterparty_monthly_merged_lines
  ├── invoice_documents.counterparty_invoice_address_id
  ├── sales_log_entries.counterparty_invoice_address_id
  └── ledger_entries.counterparty_invoice_address_id

events
  ├── event_teams
  │     └── event_team_members
  ├── event_point_entries
  └── submit_screen_config.linked_event_id

daily_reports_v2
  └── report_entries

sales_log_entries → ledger_entries (legacy_sales_log_id)
driver_ad_hoc_expenses → ledger_entries (legacy_ad_hoc_expense_id)
daily_reports → daily_reports_v2 (legacy_report_id)
```
