# シフト・アサイン フロー（現状＋新モデル接続）設計叩き台

ステータス: ドラフト（合意形成中）／最終更新: 2026-06-21
基盤: `docs/platform-design.md`。連携: `notification-flow.md`, `vehicle-session-flow.md`。
方針: **現行フローは良好＝作り直さない**。本書は「現状の記録」＋「新マルチテナント/identityモデルと今回設計（通知・チェックイン）への接続デルタ」。

---

## 1. 現行フロー（baseline・変えない）

### 1-1. 希望休（ドライバー）
- 画面 `src/app/(user)/shifts/page.tsx`：「シフト確認」「希望休提出」タブ。
- **便(slot)**: `driver_request_slots` で当人の使う便を取得。便なし=全休のみ、便あり=全休 or 対象便を複数選択。
- 提出 `POST /api/shifts/requests`：月単位、差分計算（diff）でadd/remove、実変更のみ `shift_request_logs` に監査記録。

### 1-2. 締切ルール（階層）
`loadDriverRule` の優先順位:
```
1. ドライバー個別 期間例外 → 2. ドライバー個別 既定ルール
→ 3. 全体 期間例外 → 4. 全体 既定ルール （無ければ常時オープン）
```
締切超過の半月は `isLockedDate()` でロック（編集不可）。

### 1-3. シフト確定＝行の有無（★確定フラグなし）
- 運営画面 `src/app/(admin)/admin/(ops)/shifts/page.tsx`：日付×ドライバーのグリッド、セルクリックでコース割当→**自動保存（upsert）で即確定**。
- **`shifts` に status/confirmed フラグは無い**。行があれば確定、無ければ未割当。
- **叩き台生成** `POST /api/admin/shifts/generate-draft`：希望休(全休)回避＋`driver_courses`で担当可能判定し、未割当だけ埋める。既存割当は保持。
  - ※**この会社では不使用**（アサインは元請けの指示で決まるため）。ただし機能は残す：**元請け指示が無く自社でシフトを組む他テナントには価値**がある（アンカー顧客が使わない機能が他社に効く例）。
- 運用補足: `shifts` は常にpublic（下書きでなく本番を直接編集）。前日夜には必ず決定済み（ギリギリ運用ではない）。
- **将来メモ**: アサインが元請け指示で決まる → 保留中の元請け→下請け連携（`platform-design.md` §4 course_shares）と地続き。元請けもプラットフォームに乗るなら「元請け→下請けへアサイン/指示を流す」逆方向連携の余地（今は設計しない）。

### 1-4. アサインの紐付け
- `shifts(course_id, driver_id, vehicle_id, slot, uses_external_vehicle)`。
- 担当可能判定: `driver_identities → driver_courses` で可能コース、空きスロット、全休でないこと。
- 車両選択: `vehicle_drivers`(紐付け優先)＋他社車両フラグ＋`vehicle_loans`(貸出中は同日不可)。

### 1-5. 当日アサインの参照（既に存在）
- `GET /api/me/shifts?start&end`：`driver_id` で自分のシフト＋コース名/色/車両を返す。→ **通知・チェックインが流用できる既存クエリ**。

### 1-6. 監査
- 希望休は `shift_request_logs`（add/remove・actor・スナップショット）で履歴化済み。
- **シフト(shifts)自体の変更履歴は無い**（upsertで即上書き、過去の変化を追えない）。

---

## 2. 新モデルへのデルタ（最小限・UXは変えない）

### 2-1. テナントスコープ（org_id）
- `shifts` / `shift_requests` / `courses` / 締切系 に **org_id 付与＋APIスコープ**（現状これらは company_code 絞り込み無し＝前回G1/G4）。platform-design §3 の default-deny ヘルパー経由に統一。
- 締切ルール（config/overrides/rules）は **org単位**へ（現状は全体/ドライバー別）。

### 2-2. identity/membership 適合（最小）
- `shifts.driver_id` 等は **drivers行＝membership** を指すので、新モデルでも driver_id のまま（platform-design §2-0「driversをmembershipとして温存」と一致）。**大きな改修不要**。
- 注意: 既存 `driver_identities`(勤務区分slot1/2) は **新conceptの identity(KYC/人) とは別物**。`driver_courses` が使う `driver_identity_id` は勤務区分の方。混同しない（platform-design §8 既述）。driver_id と driver_identity_id の併存は既存債務として整理（任意）。

### 2-3. 既存挙動は維持
確定フラグなし運用・叩き台生成・セルクリック割当・締切階層は**そのまま**。

---

## 3. 今回設計との接続点（ここが本題）

### 3-1. 通知トリガー「翌日アサイン」 → 決定: 案A（publishゲート不要）
- **送信時刻に存在する翌日 `shifts` 行**を通知対象にする。
- 確定済み: shiftsは常にpublic（下書きでなく本番を直接編集）、前日夜には必ず決まっている運用、**叩き台生成は不使用**（後述）→ 未完成叩き台が混ざる懸念は発生せず、**publishゲート(案B)は不要**。
- 月初・前後半の切替でギリギリになる分は **変更通知（§3-2 イベント駆動）が後追いでカバー**。

### 3-2. 変更通知（事故・台風）← 新規追加が要る
- 現状 shifts に変更履歴が無いので、**shift変更ログ（`shift_logs`、希望休ログと同型）を新設**し、これを `notification-flow.md` のイベント駆動通知の源にする。
- 事故で車両変更/割当変更 → 変更検知 → 該当ドライバーへ「【変更】」通知。
- 台風で休み → **手動ブロードキャスト**（notification-flow 手動モード）＋必要なら一括でshifts削除/変更。全削除でなく「本日休み」を告知する運用が自然。

### 3-3. チェックイン接続
- `vehicle-session-flow.md` の「稼働」= 当日 `shifts` を引いて `session.shift_id` に紐付け（me/shifts 流用）。
- **アサインが無くても稼働可**（shift_id任意、シフト外稼働は運営に可視化）＝「シフトでゲートしない」と一致。

---

## 4. データモデルのデルタ

```sql
-- スコープ付与
ALTER TABLE shifts          ADD COLUMN org_id uuid;
ALTER TABLE shift_requests  ADD COLUMN org_id uuid;
-- courses/締切系も org_id（platform-design §6）

-- シフト変更ログ（新設・変更通知の源＋監査）。希望休ログ(shift_request_logs)と同型
CREATE TABLE shift_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  shift_date date, course_id uuid, slot integer,
  driver_id uuid,                         -- 変更後（null=削除）
  prev_driver_id uuid, prev_vehicle_id uuid,
  action text,                            -- 'assign'|'reassign'|'unassign'|'vehicle_change'
  actor_type text, actor_id uuid, actor_name text,  -- スナップショット
  created_at timestamptz DEFAULT now()
);

-- (任意・案B) 日単位publish
-- CREATE TABLE shift_publications (org_id, shift_date, published_at, published_by, PRIMARY KEY(org_id, shift_date));
```

---

## 5. 未確定・要確認

1. ~~通知の安全ゲート~~ → **決定: 案A（行があれば通知、publishゲート不要）**。shiftsは常にpublic・前日夜確定・叩き台不使用のため。
2. 台風等の一斉休み: shifts一括変更か、手動ブロードキャスト告知のみか（履歴の残し方）。
3. 締切ルールの org 単位化の移行（既存の全体/ドライバー別ルールを現1社へ寄せる）。
4. driver_id と driver_identity_id の併存を整理するか（既存債務、急がない）。
5. shift_logs の action 粒度（どこまで細かく記録するか）。

---

## 6. 次アクション（合意後）

1. §5 を確定（特に通知ゲート A/B）。
2. shifts/shift_requests/courses/締切系へ org_id 付与＋スコープ（多テナント移行Phaseと同時）。
3. `shift_logs` 新設＋POST /api/admin/shifts に変更記録を追加 → 変更通知へ接続。
4. me/shifts をチェックイン「稼働」紐付けに流用。
5. （案B採用時）日単位 publish アクション＋通知ゲート。
