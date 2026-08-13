# 「仕事」の統合モデル — 単発案件と勤務(assignment)の設計

作成: 2026-08-12。ステータス: **承認済み(2026-08-12 用語・Phase 1 スコープともユーザー OK)**。
発端: 「シフトとは別に、単発案件と、そのときだけ来る人を軽く記録したい。
オンボーディングをドライバー登録と分けたい場合もある。
ただし単発を別世界にせず、継続のシフトの仕事も含めてバランスよく統合したい」(2026-08-12)。

## §0. 用語の整理(最重要)

「稼働」は既に打刻系(vehicle_sessions / mobile の WorkSessionContext・稼働開始/稼働中)で
浸透しているため、**予定側のオブジェクトには使わない**。本設計では:

| 用語 | 意味 | 実装 |
|---|---|---|
| **案件(job)** | 仕事の枠。「誰かがやるべき、日付と場所を持つ仕事」 | 継続案件 = `courses`(既存)、単発案件 = `spot_jobs`(新設) |
| **勤務(assignment)** | 日付 × 人 × 案件。「この日この人はこの仕事」 | シフト行 = `shifts`(既存)、単発参加 = `spot_job_members`(新設) |
| **稼働(work session)** | 実績の打刻(QR チェックイン→アウト) | `vehicle_sessions`(既存・変更なし) |

統合は**概念と読みモデル(§4)のレベルで行い、テーブルは分ける**。
`shifts` は「日付×コース×slot、UNIQUE制約、3552行のシフト表UI、AI取り込み、
コース単位の請求設定」まで一体の完成された機械なので触らない(§6)。

## §1. 現状の事実(2026-08-12 調査)

- `shifts.course_id` は NOT NULL・`UNIQUE(shift_date, course_id, slot)`。コースのない行は表現できない
- `courses` は請求(税基準・日額リース・請求先)・キャリア・配達エリアまで背負った重いマスタ。
  name はグローバル UNIQUE。単発のために使い捨てコースを作るとマスタが汚れる
- 勤怠の正本 `vehicle_sessions.shift_id` は**任意**(「シフト外稼働も可」が設計意図)。
  単発案件の日に打刻しても現状の仕組みのまま壊れない
- `identities`(人・グローバル・KYC) と `drivers`(org への所属 membership) は分離済み。
  `/join` は「申請(identity+membership 作成)→本登録(KYC)」を一続きにしているが、
  ステップは WizardAdapter で分離されており間引ける構造
- 日報 v2 とシフトは FK ではなく「日付×ドライバー→コース一致」の緩い結合。単発が混ざっても壊れない
- ロードマップ H: **お金の確定テーブルを単発で足さない**(締めは実入出金起点で統一設計する)

## §2. 決定事項(2026-08-12 ユーザー回答)

1. 同行者の記録は**「名前だけ」と「登録メンバー」の両対応**。さらに
   **「何を登録させるか」を設定できる**のが理想(→ §5 の項目充足モデル)
2. ライト登録(KYC なし)の人は**アプリで何もできなくてよい**(当面は管理側の記録用)
3. 報酬・請求の**金額は数値で持つ**。ただし確定はしない(参考値。§7)
4. 命名は「単発」を別世界にしない。継続のシフトも仕事 → **「案件」を傘概念にする**(§0)

## §3. Phase 1 スキーマ

### spot_jobs — 単発案件

```sql
CREATE TABLE spot_jobs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES organizations(id),
  title          text NOT NULL,                 -- 案件名(自由入力)
  job_date       date NOT NULL,                 -- 1案件=1日。複数日はコピーで増やす(§8)
  meeting_place  text,                          -- courses/shifts と同じ語彙(自由入力)
  meeting_time   time,
  end_time       time,
  client_name    text,                          -- 元請け・依頼元のメモ(取引先マスタとは結ばない)
  billing_amount integer,                       -- 請求の参考値(円)。確定ではない(§7)
  note           text,
  status         text NOT NULL DEFAULT 'planned'
                 CHECK (status IN ('planned', 'done', 'cancelled')),
  created_by     uuid REFERENCES drivers(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_spot_jobs_org_date ON spot_jobs (org_id, job_date);
```

- `org_id` は最初から NOT NULL + FK(shifts に org_id が無い反省を繰り返さない)
- コース・シフトとは無関係。UNIQUE 制約なし(同日に同名案件が2件あってもよい)

### spot_job_members — 参加者(勤務)

```sql
CREATE TABLE spot_job_members (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id       uuid NOT NULL REFERENCES spot_jobs(id) ON DELETE CASCADE,
  driver_id    uuid REFERENCES drivers(id) ON DELETE SET NULL,  -- 登録メンバー(正規/ゲスト)
  display_name text,                                            -- 名前だけの同行者
  pay_amount   integer,                                         -- 日当の参考値(円)
  vehicle_id   uuid REFERENCES vehicles(id) ON DELETE SET NULL,
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (driver_id IS NOT NULL OR display_name IS NOT NULL)
);
CREATE UNIQUE INDEX uq_spot_job_members_driver
  ON spot_job_members (job_id, driver_id) WHERE driver_id IS NOT NULL;
CREATE INDEX idx_spot_job_members_driver ON spot_job_members (driver_id);
```

- **2階層を1テーブルで**: `driver_id` あり=登録メンバー、`display_name` のみ=その日だけの人。
  後日その人が登録したら `driver_id` を埋めて昇格(display_name は消さずスナップショットとして残してよい)

### drivers.member_kind — ゲストメンバー

繰り返し来る助っ人を毎回 display_name で書くのは辛いので、
**ログインできない「ゲスト」membership** を運営が名前だけで作れるようにする:

```sql
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS member_kind text NOT NULL DEFAULT 'regular'
  CHECK (member_kind IN ('regular', 'guest'));
```

- ゲスト = `member_kind='guest'`, `identity_id NULL`, `works_as_driver=false`, `status='active'`。
  シフト表の抽出(`works_as_driver=true`)には最初から出ない。単発案件のピッカーには出す
- 既存の管理スタッフ(works_as_driver=false)と区別するために boolean ではなく kind 列にする
- ゲストは削除せず `status='inactive'` で退場(正規と同じ運用)

## §4. 統合の読みモデル(「その日の仕事」)

テーブルは分けたまま、**表示・API のレベルで1つの形に正規化する**。`packages/core` に共通型:

```ts
type DayWork = {
  date: string;                 // YYYY-MM-DD
  kind: "shift" | "spot";
  sourceId: string;             // shifts.id / spot_jobs.id
  title: string;                // コース名(summary_title 優先) / 案件名
  meetingPlace?: string; meetingTime?: string; endTime?: string;
  members: { driverId?: string; name: string; vehicleId?: string }[];
};
```

消費側(段階導入):
1. **管理の日別ビュー**(シフト表のスマホ日別ビュー・day-summary 系)に単発案件を並記
2. `/api/me/shifts` 相当に自分の単発参加を混ぜる(mobile ホームの「今日のシフト」に出す)
3. 地図の作戦盤: 単発案件の集合場所にゴーストピン(map-ux 設計に既出。座標が必要 → §8)

これにより「継続も単発も同じ“仕事”として見える」を、shifts を壊さずに実現する。

## §5. オンボーディングの分解 — 項目充足モデル

「アカウント作成+フルKYC」の一本道をやめ、**登録を項目の集合として扱う**:

- 項目 = 氏名 / 電話(OTP) / フリガナ / 生年月日 / 住所 / 免許写真 / 顔写真 / 口座 / 規約同意
- 現行 `/api/me/registration` の complete 判定(免許+顔+期限+住所)は「正規ドライバーに必要な項目セット」と再解釈する

```sql
ALTER TABLE invites ADD COLUMN IF NOT EXISTS required_items text[];
  -- NULL = 現行フル(正規ドライバー)。例: '{name,phone_otp,terms}' = ライト招待
```

- 招待作成 UI にプリセット「正規ドライバー(フル)」「ライト(電話+氏名+規約のみ)」を置き、
  カスタムで項目をトグルできるようにする(ユーザー要望「何を登録させるかを設定したい」)
- ライト招待の完了時: identity(電話検証済み) + `drivers { member_kind: 'guest' → 'regular'? }`
  → **Phase 1 ではライト招待は作らない**。ゲストは運営が名前で直接作る(§3)。
  ライト招待・本人による項目充足・ゲスト→正規昇格(残り項目だけ埋める)は Phase 2
- 昇格フロー(Phase 2): 既存ゲスト membership を指す招待(`invites.driver_id`)を発行し、
  本人が不足項目を埋めたら `member_kind='regular'` + `works_as_driver` 付与 + 承認フローへ合流

## §6. やらないこと

- `shifts` / シフト表 UI / AI 取り込みには**手を入れない**(単発案件は別レイヤー、統合は §4 の読みモデルで)
- 単発のために `courses` にレコードを作らない(使い捨てコース禁止)
- お金の**確定**テーブル・締め処理を作らない(ロードマップ H の合意。金額は参考値のみ)
- ライト会員向けのアプリ機能(ログイン後画面・通知)は当面作らない(§2-2)

## §7. お金の扱い

- `spot_jobs.billing_amount`(案件の請求参考値) / `spot_job_members.pay_amount`(人ごとの日当参考値)
- 集計画面に出すときは**「参考値」と明示した合算のみ**。payrolls・請求書・締めには乗せない
- 税(税抜/税込)は当面持たない。請求書に載せる段になったら §H の締め設計と一緒に決める

## §8. 未決・将来

- **UI は継続と単発を同格に扱う方向へ**(2026-08-12 ユーザー明示): コースから作った仕事も
  単発の仕事も、画面上は「同じ立ち位置の仕事」に見えるよう今後寄せていく。
  §4 の読みモデルはその布石。日別ビュー・地図・mobile ホームで kind による見た目の格差を作らない
- **単発の人への仕事内容の共有**(2026-08-12 ユーザー明示・将来): 案件の日時・集合場所・内容を
  参加者(ゲスト・名前だけの人含む)に共有できると完璧。共有リンク(閲覧専用トークン)か
  LINE 通知の流用が候補。ライト招待(§5 Phase 2)と地続きの機能
- **複数日案件**: Phase 1 は「1日1行・コピーで増やす」。頻発するなら group_id か日付範囲を検討
- **地図連携**: ゴーストピンには座標が要る。`meeting_place`(自由文)とは別に
  lat/lng か map_places 参照を足す(地図フェーズで。courses.meeting_place の「場所の分割」課題と同根)
- **打刻との接続**: `vehicle_sessions.spot_job_id` を足すか、shift_id NULL のまま日付一致で読むか。
  車を使わない単発(手伝いのみ)の勤怠をどうするかも含めて保留
- **日報**: 単発案件は個数報告が無いことが多い想定で Phase 1 は対象外。必要になったら
  daily_reports_v2.course_id NULL 運用 + spot_job_id 追加を検討
- **コース=継続案件の見せ方**: 将来「案件」一覧で継続(コース)と単発を並べて見せるか。
  courses の呼び替えは表示ラベルの問題なので急がない

## §9. Phase 1 の実装スコープ(目安)

1. migration: `spot_jobs` + `spot_job_members` + `drivers.member_kind`
2. API: `/api/admin/spot-jobs`(月別一覧 GET / POST / PATCH / DELETE、
   capability は暫定で `can_manage_shifts` 系に相乗り→専用 capability は必要になってから)
3. 画面: 管理に単発案件の一覧+作成/編集(参加者ピッカー=正規+ゲスト+名前だけ行)。
   ゲストメンバーの作成はこの画面内から(名前だけ・1タップ)
4. 読みモデル: 管理の日別ビューに単発案件を並記(§4-1)
