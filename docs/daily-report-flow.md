# 日報フロー（現状＋新モデル接続）設計叩き台

ステータス: ドラフト（合意形成中）／最終更新: 2026-06-21
基盤: `docs/platform-design.md`。連携: `shift-assignment-flow.md`, `vehicle-session-flow.md`, 既存 `aggregation-redesign.md`。
方針: **現行v2（集計刷新済）は良好＝作り直さない**。本書は新マルチテナント/identityモデルへの接続デルタ。

---

## 1. 現行フロー（baseline・変えない）

### 1-1. テーブル
- **`daily_reports_v2`**（現役）: ヘッダ（`driver_id`, `report_date`, `course_id`, `carrier_id`, `identity_id`=勤務区分, `vehicle_id`, `meter_value`, `submitted_at`, `approved_at/by`, `rejected_at/by`, `legacy_report_id`）。ユニーク (driver_id, report_date, course_id)。
- **`report_entries`**（EAV縦持ち）: (report_id, unit_id, field_key) → value_num/value_text。運営定義の任意フィールドを動的格納。
- マスタ: `carriers`(code), `units`(carrier配下・billing_type), `unit_fields`(field_key/label/input_type/is_billable)。
- **`daily_reports`(v1)**: 凍結。`legacySync` で v2 と双方向同期、`mirrorApprovalToV2` で承認同期。
- 諸報告: `oil_change_reports`（report_kindフォームビルダー、answers/attachments jsonb、capability=oil_mileage/expense）。

### 1-2. 提出フロー（ドライバー）
- `/app/(user)/submit/SubmitPageClientV2.tsx`：profile(勤務区分slot) + `/api/me/report-form?date` で当日shift→course→carrier→units→fields を生成。
- 入力（course×unit×field_key）→ `POST /api/reports/v2`（ヘッダ＋entries縦持ち）。
- carrier/course/車両/メーターは shift と前回値からサジェスト。

### 1-3. 承認→自動記録（運営）
- `/admin/(ops)/daily` → `POST /api/admin/daily/approve|reject`（ADMIN_OR_VIEWER）。
- 承認時：同日同ドライバーの全行を approved に。**メーター最大値→`vehicles.current_mileage` を"増加時のみ"更新**（巻き戻り防止）。
- 差戻し：rejected に、承認リセット。

### 1-4. 集計コア（aggregation-redesign）
- `load.ts`(loadAggregationData) → `compute.ts`(純関数 `reportContributions`：従量=billable×course_unit_rates＋固定=course_fixed_rates) → `Contribution[]` → 任意軸 sumBy。
- `isCountableReport = approvedAt!=null && rejectedAt==null`。
- **driver_id 中心**（identity_id=勤務区分はランキングのslot分離に使用）。ledger_entries で手動調整。
- `legacyShape.ts` が旧平坦形式の読み手を v2 ソースで再構成（互換層）。

---

## 2. ★命名衝突の解消（最重要デルタ）

**問題**: 既存の「identity」は**勤務区分スロット**の意味（1ドライバー最大2スロット、driver_code/office_code を持つ）。我々の新 `identities` は **KYC＝人**。同じ "identity" で意味が衝突 → KYC導入時にバグの温床。

| 既存（勤務区分の意味） | 新（KYC/人の意味） |
|---|---|
| `driver_identities` テーブル | `identities`（新設・人/KYC） |
| `daily_reports_v2.identity_id` | — |
| `driver_courses.driver_identity_id` | — |
| core型 `DriverIdentity` | `Identity` |

**推奨（案A）: 既存の"勤務区分"を改名**（`driver_identities`→`driver_work_slots`、`identity_id`→`work_slot_id`、型`DriverIdentity`→`DriverWorkSlot`）。新KYCがクリーンな `identities` を取る。
- 利点: 新アーキの中心概念（人=identity）が正しい名前を持つ。"勤務区分"は元々 work_slot の方が正確で**明確化にもなる**。
- 欠点: 機械的だが広範なリネーム（driver.ts/submit/aggregation/monthly-totals 等）。段階実施可。

**案B（低churn）**: 新KYCを別名（`persons`/`kyc_identities`）にして既存はそのまま。中心概念の名前が一生いびつ。→ 非推奨。

→ **決定: 案A**（既存"勤務区分"を driver_work_slots/work_slot_id へ改名、新KYCが identities を取る）。段階実施。

---

## 3. テナントスコープのデルタ

- **`daily_reports_v2` に org_id を冗長付与**（集計高速化＋安全）。`report_entries` は report 経由で従属。
- **集計ローダ（load.ts, legacyShape.ts）に orgId を必須引数化**（単一通り道で強制、platform-design §3）。
- 日報系API（`/api/reports/v2`, `/api/admin/daily/*`）に org スコープ追加（現状 company_code 絞り込み**無し**＝既知ギャップ）。
- マスタ: `carriers`/`units` は共有＋**org有効化（`company_carriers`）でフィルタ**。`course_unit_rates`/`course_fixed_rates` は course（org所有）経由で自然にorgスコープ。

---

## 4. identity/membership 適合

- **`daily_reports_v2.driver_id` = membership（drivers行）**。集計の driver_id 軸＝membership軸。**無改修**。
- **`approved_by`/`rejected_by` = 承認者の membership**（運営者もmembership）。FK概念は維持、admin専用フィールド化は不要。
- org_id は driver(membership) から導出可だが、集計のため日報に冗長保持（§3）。

---

## 5. 承認→自動記録の収束（車両走行距離）

- 走行距離の更新元が2つになる: **日報メーター（承認時）** と **車両セッションのオドメーターOCR（チェックイン/アウト）**（`vehicle-session-flow.md` §7）。
- **`vehicles.current_mileage` を単一ソース**とし、両方とも**「増加時のみ更新」の同じガード**を通す。二重/巻き戻りを防止。
- capability=oil_mileage（オイル管理）/ expense（ledgerへ自動ポスト）の既存挙動は踏襲。

---

## 6. v1廃止・ハードコード一掃

- v2カットオーバー済 → **`legacySync`/v1 を段階廃止**、最終的に v1 のYAMATO/AMAZON固定カラムを削除。
- **運営日報の一覧表示は今もYAMATO/AMAZON固定**（`admin-daily-legacy-display` 既知の残作業）→ carriers駆動の動的化を完了。
- 旧 `/api/reports`(POST) のhardcodeは凍結のまま除去。請求のbucket分類（carrier.code）は新キャリア追加で漏れない設計に。

---

## 7. データモデルのデルタ

```sql
ALTER TABLE daily_reports_v2 ADD COLUMN org_id uuid;   -- 冗長保持（集計）
-- report_entries は report経由で従属（org列不要）
-- course_unit_rates/course_fixed_rates は course経由でorg（必要なら冗長org_id）

-- ★命名衝突（案A・段階リネーム）
-- driver_identities → driver_work_slots
-- daily_reports_v2.identity_id / driver_courses.driver_identity_id → work_slot_id
-- 新KYC: identities（platform-design §6）
```

---

## 8. 未確定・要確認

1. ~~命名衝突の解消~~ → **決定: 案A**（既存"勤務区分"を driver_work_slots/work_slot_id へ改名、新KYCが identities を取る）。段階実施。
2. v1/legacySync の廃止時期（いつ v1 を切るか）。
3. 運営日報一覧の動的化（admin-daily-legacy-display）の優先度。
4. course_unit_rates/course_fixed_rates に org_id を冗長付与するか（course経由導出で足りるか）。
5. 走行距離の単一ソース化（日報メーター×セッションオドメーターの統合点）の実装。

---

## 9. 次アクション（合意後）

1. §8 を確定（特に命名衝突 案A）。
2. daily_reports_v2 へ org_id 付与＋集計ローダ orgId 必須化＋日報APIスコープ。
3. （案A）勤務区分の段階リネーム（型→DB→参照）。
4. 走行距離の単一ソース統合（日報メーター＋セッションオドメーター）。
5. v1/legacySync 廃止計画＋運営日報一覧の動的化。
