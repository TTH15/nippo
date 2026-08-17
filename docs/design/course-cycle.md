# コースの「便（cycle）」設計

ステータス: 実装中（Phase 1）／作成: 2026-08-17
関連: `docs/design/work-model.md`（案件モデル）、`docs/shift-assignment-flow.md`、`docs/aggregation-redesign.md`

---

## 0. 何を解くのか

「豊中Amazon」には 1便のみ・2便のみ といった区分がある。現状これを**別々のコースレコード**
として作っている（`豊中Amazon 1便` / `豊中Amazon 2便`）。そのため:

- 便が**コース名の文字列の中**にしか無く、並び順・絞り込み・バッジ表示に使えない
- シフト表 AI 取り込みでラベル「豊中」が2件ヒットして自動確定しない（手動辞書で救っている）
- 「同じ現場の1便と2便」という関係がデータ上どこにも表現されていない

→ **便を courses の構造として持つ**。1コース = 1現場、その下に便がぶら下がる。

### 0-1. 前提となる合意（2026-08-17・ユーザー提供の検討ログより）

- **cycle は「同じコースの中で1便・2便を区別する」ためだけの概念**にする。
  「何でも入れられる汎用区分」にしない。表現しきれないものが出てから一般化する。
- **時間情報（集合・開始・終了目安）は cycle が持つ**。
- **コースごとに「サイクルを使用する / しない」を選ぶ**。
  - 使用しない → **コース自身が1日の稼働時間を持つ**（今と同じ。洛南R のような単便のコース）
  - 使用する → 時間は cycle 側へ移る（豊中Amazon の C1/C2/C3）
  これで「サイクルが無い」を NULL で表現する必要がなくなる。
- **UI では cycle が複数あるコースだけバッジを出す**。1つしか無いコースに `[C1]` は出さない。
  データ上は cycle が存在していても、画面では省略する。
- シフト表の1行の並びは `人 → 時刻 → コース → [便] → 車両`。
- ★**サイクルの ON/OFF を切り替えても、既存の割当（過去のシフト）は変えない**。
  コース設定は「現在の定義」であって「過去に何だったか」ではない。

---

## 1. ★用語の整理（先にこれを決める）

このリポジトリには "slot" と "便" が乱立しており、**新しい概念を足す前に語を割り当て直す**。

| 実体 | これまでの呼び名 | **これからの呼び名** |
|---|---|---|
| `course_cycles`（新設） | — | **便**（1便・2便） |
| `shift_request_slots` / `courses.slot_id` | 便区分（時間帯） | **時間帯**（午前・午後・4時）※「便」と呼ばない |
| `shifts.slot` | slot | **枠**（同一コース同一日の何人目か。人数の枠番号） |
| `driver_identities.slot` | 勤務区分 slot1/2 | **勤務区分**（人の別人格。便でも時間帯でもない） |
| `driver_fixed_expenses.cycle` | 支払サイクル | そのまま（別テーブル・別文脈） |
| unit_fields の `group_label`（午前/午後/4便） | 日報の項目見出し | そのまま（**日報フォームの見た目**であって便ではない） |

**画面のラベルも合わせて直す**: コース管理の「便区分（時間帯）」→「時間帯」。
これをやらないと、同じ画面に「便」が2つ並ぶ。

---

## 2. データモデル

### 2-1. `courses.uses_cycles`（モードの明示）

```sql
ALTER TABLE courses ADD COLUMN uses_cycles boolean NOT NULL DEFAULT false;
```

- `false`（既定・今の全コース）: コース自身が時間を持つ。便の概念は出てこない。
- `true`: 時間は `course_cycles` が持つ。画面に便が現れる。

「サイクル未使用」を NULL や 0件で暗黙表現せず、**設定として明示する**。
これにより「便を1つだけ作ったコース」と「便を使わないコース」を意図どおり区別できる。

### 2-2. `course_cycles`（新設）

```sql
CREATE TABLE course_cycles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id   uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  cycle_no    int  NOT NULL,          -- 1, 2, 3 …（0 は使わない。0 = 便なしの予約値）
  label       text,                   -- 任意。NULL なら「N便」と表示する（"C1" 等も入れられる）
  -- 便の時間。uses_cycles = true のときはこちらが主
  meeting_place text,
  meeting_time  time,                 -- 集合
  arrival_time  time,                 -- 開始
  end_time      time,                 -- 終了目安
  max_drivers   int,                  -- NULL ならコース既定
  sort_order    int  NOT NULL DEFAULT 0,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (course_id, cycle_no)
);
```

実効値の解決:

| コースの設定 | 集合・開始・終了の出どころ |
|---|---|
| `uses_cycles = false` | `shifts.<列> ?? courses.<列>`（**今と同じ**） |
| `uses_cycles = true` | `shifts.<列> ?? course_cycles.<列> ?? courses.<列>` |

`slot_id`（時間帯マスタ）は便には持たせない。**時間帯と便は別概念**で、
便が実時刻を持つ以上、便ごとの時間帯分類は要らない（§1）。

### 2-3. 参照側は `cycle_no int NOT NULL DEFAULT 0`

**NULL ではなく 0 を「便なし」の値にする。** 理由:

- Postgres の UNIQUE は NULL 同士を「別物」として扱うため、`UNIQUE(..., cycle_id, ...)` に
  NULL が混ざると**重複を止められない**（`NULLS NOT DISTINCT` は PG15 以降でバージョン依存）
- `DEFAULT 0` なら既存行が自動で埋まり、バックフィルが要らない
- 「0 = 便の区別なし／全便」という意味を全テーブルで統一できる

| テーブル | 追加列 | 一意制約の変更 |
|---|---|---|
| `shifts` | `cycle_no` | `UNIQUE(shift_date, course_id, slot)` → `UNIQUE(shift_date, course_id, cycle_no, slot)` |
| `daily_reports_v2` | `cycle_no` | 部分 UNIQUE `(driver_id, report_date, course_id[, identity_id])` に `cycle_no` を追加 |
| `course_unit_rates` | `cycle_no` | `UNIQUE(course_id, unit_id)` → `UNIQUE(course_id, cycle_no, unit_id)` |
| `course_fixed_rates` | `cycle_no` | PK `course_id` → PK `(course_id, cycle_no)` |
| `driver_courses` | `cycle_no` | `UNIQUE(driver_identity_id, course_id)` → `+ cycle_no`。**0 = 全便を担当可** |
| `shift_change_logs` | `cycle_no` | （制約なし・記録のみ） |

`ledger_entries` / `shift_import_label_maps` は当面 `cycle_no` を持たない
（前者は金額の元帳で便の粒度を要さない。後者は §5 で別途扱う）。

### 2-4. 単価の解決順

`course_unit_rates` / `course_fixed_rates` は **`cycle_no` 完全一致 → 無ければ `cycle_no = 0`**
の順で引く。これで「便ごとに単価が違う会社」も「便で変わらない会社」も同じコードで通る。

---

## 3. 段階（フェーズ）

**Phase 1（追加のみ・既存挙動不変）**
1. migration: `courses.uses_cycles` ＋ `course_cycles` 新設 ＋ 各テーブルへ
   `cycle_no DEFAULT 0` ＋ 一意制約の張り替え
2. コース管理に「運用単位」の切替（サイクルを使用する / しない）と便の編集 UI
   （追加・削除・並べ替え・ラベル・便ごとの集合/開始/終了目安・人数）
3. 「便区分（時間帯）」→「時間帯」のラベル改称
4. **`uses_cycles = false` のままなら今日と完全に同じ挙動**（誰も便を作らない限り何も変わらない）

**Phase 2（便を使い始める）**
5. シフト表: 便を持つコースは便ごとのセルに分かれる。**便が複数あるコースだけバッジを出す**
6. 日報: 同じコースの1便・2便を別々に提出できる（フォーム生成の重複排除を course_id →
   course_id+cycle_no に）
7. 通知・PDF・ドライバー画面に便バッジ
8. 単価編集を便ごとに

**Phase 3（既存データの統合）**
9. 運営画面に**統合ツール**: 「このコースを別コースの便として取り込む」。
   `shifts` / `daily_reports_v2` / 単価 / `driver_courses` / `shift_import_label_maps` の
   付け替えをプレビュー付きで実行する。
   **名前からの自動推定でブラインドに実行しない**（本番データのため必ず人が確認する）。

---

## 4. ★破壊的変更の扱い

### 4-1. `course_fixed_rates` の PK 変更

PK を `(course_id)` → `(course_id, cycle_no)` に変えるのは破壊的。
既存行は `cycle_no = 0` で埋まるため**値としては無傷**だが、
`ON CONFLICT (course_id)` を使っている書き込みは全て `(course_id, cycle_no)` へ直す必要がある。

### 4-2. 請求明細の `lineKey`

`server/billing/computeCounterpartyMonthRevenue.ts` / `driverPayout.ts` の
`fx:<courseId>:drv:<driverId>` / `u:<courseId>:<unitId>:drv:<driverId>` は
**手修正済みの請求明細とマージするための鍵**。ここに cycle を混ぜると過去分の突合が壊れる。

→ **`cycle_no = 0` のときは今までと同じ文字列を出す**（`fx:<courseId>:drv:<driverId>`）。
0 以外のときだけ `fx:<courseId>#<cycle>:drv:<driverId>` にする。
これで既存の請求データは一切影響を受けない。

### 4-3. Phase 3 のコース統合

コースを統合すると `course_id` が変わるため、上記 lineKey も変わる。
**過去月の請求を再生成すると明細が変わる**ので、統合ツールは
「確定済みの請求がある月には触らない」ことを保証する（または統合を締め後に限定する）。

---

## 5. シフト表 AI 取り込み

現状 `shift_import_label_maps` は `raw_label → course_id` の1段辞書。
元請のシフト表セルには「豊中」「1便」のようにラベルと便が別々に現れる。

Phase 2 以降で `course_cycle_no` を辞書に持たせ、`豊中 → (豊中Amazon, 便1)` と解決できるようにする。
Phase 1 では辞書の形は変えない（`cycle_no = 0` で従来通り）。

---

## 5-2. ★サイクルの ON/OFF と既存シフト

「豊中Amazonを普通のコースからサイクルありに変更」したとき、既にシフト表に入っている
`豊中Amazon 09:00–17:00` をどうするか。

**ルール: 設定変更は既存の割当に遡及しない。**

- 既存の `shifts` 行は `cycle_no = 0` のまま残る（時刻は `shifts.*` か `courses.*` で解決される）
- 画面では便バッジを出さず「便未設定」として扱う
- 運営が必要と判断したら、便を選び直して割り当て直す

コース設定は**現在の定義**であって、過去のシフトが何だったかの記録ではない。
過去分を書き換えると請求・日報の整合が崩れるため、遡及させない。

---

## 6. 未確定

1. 便を持つコースで `cycle_no = 0` のシフトが残った場合の見せ方（§5-2 の移行期の状態）。
   → 「便未設定」と明示する方針までは決めた。バッジの出し方は Phase 2 で詰める。
2. `driver_courses` の `cycle_no = 0`（全便）と個別便の同居をどう見せるか。
3. 便ごとに配達エリア（`courses.delivery_area`）が違う場合。現状はコース単位のまま。
4. `courses.name` のグローバル UNIQUE。統合で同名が生まれることは無い（統合＝1本化）ので
   Phase 3 まで据え置き。
