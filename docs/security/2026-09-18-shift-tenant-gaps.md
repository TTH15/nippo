# シフト系3ルートのテナント境界の抜け（2026-09-18 発見・修正）

O-3（通常編集の競合検知）でシフト系のAPIを読んでいるときに見つけた。**本番で悪用された形跡を確認したわけではない**（アクセスログの調査はしていない）。修正はローカルのみで、本番未公開。

## 何が抜けていたか

`shifts` / `shift_requests` / `shift_request_logs` はいずれも **`org_id` 列を持たない**（コースやドライバー経由で会社が決まる）。そのため `scripts` の `check:tenant` は「テナント列を持つテーブル」として拾わず、自動検査に載っていなかった。呼び出し側が自社のコース・ドライバーかを確かめないと、他社のIDを渡すだけで届いてしまう。

| ルート | 影響 | 必要だった条件 |
|---|---|---|
| `POST /api/admin/shifts/times` | **他社のシフトの集合・着車・終業時刻を書き換えられる** | `courseId` が自社のコースか |
| `DELETE /api/admin/shifts/requests/[id]` | **他社の希望休を削除できる** | その行の `driver_id` が自社のドライバーか |
| `GET /api/admin/shifts/requests/history` | **他社の希望休の変更履歴を読める**（誰がいつ休みを出したか） | `driverId` が自社のドライバーか |

いずれも「どこかの会社で `can_manage_shifts` / `can_view_shifts` を持っていること」と「対象のUUIDを知っていること」が要る。UUIDは推測しにくいが、**複数社に所属した経験のある運営や、過去に画面で見たIDを控えていれば分かる**ので、秘匿性に依存した状態だった。

## 直し方

3本とも、既存の `belongsToOrg`（`server/db/adminResourceScope.ts`）で自社のコース・ドライバーかを確かめてから DB を触るようにした。他社のIDは **404「見つかりません」** で返す（存在の有無を漏らさない）。

- `times`: `courseId` の検証に加えて、`shiftDate` / `courseId` の形式検査も `isDateOnly` / `isUuid` へそろえた。
- `requests/[id]`: 対象行が無い場合も 404 にした（削除の空振りを成功として返していた）。
- `requests/history`: ドライバーを確かめてからログを読む。

## 再発防止

`apps/web/src/test/security/shiftTenantRoutes.test.ts` に6件のテストを置いた。他社のIDでは **DB を触る前に 404 で止まること**（`supabase.from` が呼ばれないこと・削除が走らないこと）まで検査している。

**`check:tenant` は org_id 列を持つテーブルしか見ない**。本番の103表のうち49表に org 列が無く、検査の外にあった。コースやドライバー経由で会社が決まるテーブル（`shifts` `shift_change_logs` など）を触るルートを足すときは、この検査に頼らず `belongsToOrg` を自分で呼ぶこと。

### 検査の穴そのものを埋める（migration 174 / 2026-09-18）

「見つけたら直す」を「書き忘れたら検査で落ちる」に変えるため、**org 列が無い表に org_id を足していく**。第1弾が希望休まわりの2表。

- `supabase/migrations/174_shift_requests_org_id.sql`
  - `shift_requests` / `shift_request_logs` に **NULL 許容の** `org_id` を足し、`drivers` から backfill する。
  - 複合外部キー `(org_id, driver_id) → drivers(org_id, id)` で、行の org とドライバーの所属が食い違えないようにした（相手側に `uq_drivers_org_id` を作る）。`ON UPDATE CASCADE ON DELETE CASCADE` 付き。付けないと所属変更が希望休の行に阻まれて失敗する。
  - **NOT NULL は入れない**。全ての書き込み経路が org_id を入れていることを確認してから別の migration で入れる（先に入れると、入れ忘れた経路で希望休の提出が落ちる）。複合FKは MATCH SIMPLE なので org_id が NULL の行では検査されず、移行中も安全。
- 列が増えたことで `check:tenant` の対象表が 57 件になり、この2表を触る12箇所が検出された。全て実体を確認し、
  - 書き込み（提出・履歴記録）は `org_id` を入れるようにした。`ShiftLogRow.org_id` を**型で必須**にして、呼び出し側の入れ忘れを型検査で止める。
  - 読み取り・削除は `.eq("org_id")` を足さず、既存の絞り（本人の `driver_id` 固定、または `belongsToOrg` 通過後のID、または自社 drivers から作った `driverIds`）を `// tenant-scope-ok:` で明示した。**本人の driver_id 固定は org 絞りより狭い**ので、置き換えると防御が弱くなる。

#### 適用順に依存しないこと

174 を本番へ適用する前にコードが出ても希望休の提出が落ちないよう、`server/shiftRequests/orgColumn.ts` に退避経路を置いた。`org_id` 列が無いことだけが原因のエラー（42703 / PGRST204）なら、`org_id` を落として書き込み直す。vehicles の `part_colors` / 一時使用不可列と同じ扱い。**174 が本番に入りきったら、この退避と呼び出し側の分岐は消してよい。**

## 残っている確認

- 他の領域（車両・日報・請求など）で同じ形の抜けがないかは未調査。
- 本番のアクセスログを見て実際に他社IDでの呼び出しがあったかは確認していない。
- **残り約46表**（`shifts` は41箇所が絡むので単独で1回分）。同じ手順（NULL 許容で追加 → backfill → 複合FK → 呼び出し側 → 後から NOT NULL）で順に潰す。
- 174 適用後に `org_id IS NULL` の行が増えていないかを一度見る。増えていなければ NOT NULL（175）を入れられる。
