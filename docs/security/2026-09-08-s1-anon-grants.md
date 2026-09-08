# S-1 anon / authenticated の DB 権限 棚卸し（本番・2026-09-08）

対象: 本番 Supabase `ooirajiizydcynyglvuv`（PostgreSQL 17.6）。
実行: `scripts/db/db.sh qf scripts/db/audit/s1-anon-grants.sql`（読み取り専用セッション）。

## 結論

**いま情報が漏れてはいない。守っているのは RLS 一枚だけで、GRANT は全開のまま。**

- `public` の 94 テーブル中 **90 で anon と authenticated が
  `SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER` を保持**している。
  明示 REVOKE 済みは migration 154 の `org_record_forms` / `org_record_form_versions` /
  `org_records` / `org_record_events` の 4 つだけ。
- 一方で **90 テーブルすべてで RLS が有効・policy は 0 本**。policy が無い RLS は
  「service_role 以外は 1 行も見えない」を意味するため、anon キーで PostgREST を叩くと
  200 が返るのに中身は `[]` になる（実測: `roles` は service_role で 8 行、anon で 0 行）。
- RLS を有効にしているのは migration ではなく、DB 側のイベントトリガ **`rls_auto_enable`**
  （`public` に CREATE TABLE すると自動で `enable row level security` を実行する）。
  つまり RLS は「意図して設計した防壁」ではなく、**Supabase 側の安全ネットが偶然効いている**状態。
- RLS を迂回する経路（`security_invoker` が off のビュー・マテビュー）は**存在しない**。
  `public` は 94 個すべて通常テーブルで、ビューは 0。
- Storage は 7 バケットすべて非公開、`storage.objects` も RLS 有効・policy 0 本。
  ただし anon は `storage.objects` / `storage.buckets` に対しても全 DML 権限を持っている。
- **DEFAULT PRIVILEGES** が `public` と `storage` に残っており、**今後 postgres が作る
  テーブル・関数・シーケンスにも自動で anon / authenticated の全権限が付く**。
- 関数 6 本が anon から EXECUTE 可能（`admin_daily_pending_dates` `admin_daily_unread_count`
  `chat_thread_summaries` `map_latest_sessions` `vehicle_daily_lease_agg` は SECURITY INVOKER
  なので RLS で空を返す。`rls_auto_enable` は SECURITY DEFINER だがイベントトリガ専用で
  単体呼び出しは失敗する）。

## なぜ危ないか（今は無害でも直す理由）

1. **policy を 1 本足した瞬間、そのテーブルは読みだけでなく書きも開く。**
   地図の共有ビュー Stage 1 は「anon キーをブラウザに配る」設計なので、
   将来 `map_latest_positions` 相当に policy を足すと、同じキーで INSERT / UPDATE / DELETE まで通る。
2. **RLS が 1 テーブルでも外れたら即全開。** ダッシュボードの操作、`rls_auto_enable` の
   失敗（例外は握り潰してログのみ）、`public` 以外のスキーマへの作成、いずれも起こりうる。
3. **anon キーは share-session API で運営ユーザーのブラウザに渡っている**（`/api/admin/map/share-session`）。
   低機微な presence 用途のつもりでも、鍵そのものは DB 全体に対する入場券として有効。

## やること（案）

`supabase/migrations/159_revoke_anon_authenticated_grants.sql`

1. `public` と `storage` の全テーブル・シーケンス・関数から anon / authenticated を REVOKE。
2. `ALTER DEFAULT PRIVILEGES` を取り消し、今後作る表に権限が付かないようにする。
3. `public` スキーマの USAGE は残す（PostgREST が接続時に必要）。
4. service_role の権限は一切触らない＝アプリは無影響。

適用後の期待値: anon キーで叩くと 200/[] ではなく **401 permission denied** になる。
共有ビュー（Realtime の broadcast / presence）はテーブル権限を使わないので影響しない。

## 検証手順

```bash
scripts/db/db.sh qf scripts/db/audit/s1-anon-grants.sql   # 適用前後で 3. の集計を比較
# 期待: anon_can_select が 90 → 0、anon_blocked が 4 → 94
```

アプリ側は「日報の送信・シフト表・地図・請求書」を本番で一巡し、
service_role 経由の読み書きが従来どおりであることを確認する。

## dev での適用結果（2026-09-08）

`wdbifbzwxivgefyxpzbi`（81 テーブル）へ migration 159 を適用した。

| 指標 | 適用前 | 適用後 |
|---|---|---|
| anon が SELECT できるテーブル | 77 / 81 | **0 / 81** |
| anon / authenticated の権限が残る public テーブル | 77 | **0** |
| anon が EXECUTE できる public の関数 | 3 | **0** |
| postgres 由来の DEFAULT PRIVILEGES（anon 付き） | 6 | **0** |
| `anon` で `select count(*) from drivers` | 通る（RLS で 0 行） | **permission denied** |
| `service_role` で同じクエリ | 5 行 | **5 行（無影響）** |
| `anon` の public スキーマ USAGE | あり | あり（維持） |

storage は `buckets_analytics` の一部列で `no privileges could be revoked` の WARNING が出るが、
`storage.objects` / `buckets` の REVOKE は成功する（所有者が異なる列だけ残る）。

### 取り消せなかったもの（既知の残り）

`supabase_admin` が持つ `public` の DEFAULT PRIVILEGES（テーブル・関数・シーケンス）は
postgres では取り消せない（`permission denied to change default privileges`）。dev / 本番の両方に存在する。

- 実害: migration もダッシュボードの SQL Editor も **postgres** で走るため、通常の運用では権限は復活しない。
- 対策: テーブルを追加する migration のあとに棚卸し SQL を流し、`anon_can_select = 0` を確認する。

## 本番での適用結果（2026-09-08 12:2x）

`ooirajiizydcynyglvuv` に migration 159 を適用（1トランザクション・`lock_timeout 3s`）。

| 指標 | 適用前 | 適用後 |
|---|---|---|
| anon が SELECT できる public テーブル | 90 | **0 / 95** |
| anon / authenticated の権限が残るテーブル | 90 | **0** |
| anon が EXECUTE できる public の関数 | 6 | **0** |
| postgres 由来の DEFAULT PRIVILEGES（anon 付き） | 6 | **0** |
| anon の public スキーマ USAGE | あり | あり（維持） |
| service_role の SELECT / INSERT | 可 | **可（無影響）** |

REST での実測:

- anon キー → `401 {"code":"42501","message":"permission denied for table drivers"}`
  （適用前は `200 []`）
- service_role → `drivers 34` / `daily_reports 614` / `vehicles 17` 行を従来どおり返す

本番アプリの回帰確認（書き込みなし）:

- `/login` `/join` はいずれも 200
- `POST /api/auth/login`（存在しないドライバーコード）→ 401 と「見つかりませんでした」＝
  service_role 経由の DB 照会が正常に動作

## 残っている論点

- `supabase_admin` の DEFAULT PRIVILEGES は取り消せないまま（上記の既知の残り）。
- 地図の共有ビュー Stage 1 で anon キーをブラウザへ渡す設計は維持できるが、
  本来は legacy anon key ではなく新形式の publishable key を使うべき（別タスク）。
- `storage.buckets_analytics` の一部列は所有者の都合で権限が残る（バケットは全て非公開）。
