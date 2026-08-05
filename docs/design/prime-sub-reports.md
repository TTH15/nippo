# 元請け／下請けの日報連携

2026-08-06 起票。`platform-design.md §4`（土台のみ確保・実装保留）を、他社提供が現実になった
段階の設計として具体化する。§4 で確定済みの考え方は踏襲する:

- 共有の単位は**会社ではなくコース**（下請けは複数の元請けにぶら下がる）
- 見せるのは**報告（配送実績）のみ**。給与・個人情報・口座は対象外
- 元請けがアプリを使う／使わないの両方を想定する

---

## 1. いちばん大事な原則: 同じ配送を二度入力させない

現場の実態として、下請けのドライバーは自社の日報を書き、元請けにも別フォーマットで報告している
ことが多い。ここを**1回の入力で両方満たす**のが、この機能の価値の中心。

- **作成者は下請け**（実際に走った側）。元請けは**読む**。二重入力にしない
- 元請けの「承認」は、元請け側のワークフローとして**別レイヤー**に持つ
  （下請けの承認状態を上書きしない。両社の承認は独立した事実）

---

## 2. モデル

```sql
CREATE TABLE course_shares (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id       uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE, -- 下請け側のコース
  from_org_id     uuid NOT NULL,        -- 共有する側（下請け）
  to_org_id       uuid,                 -- 共有される側（元請け）。アプリ未使用なら NULL
  alias           text,                 -- 元請け側での呼び名（コース名の不一致を吸収）
  scope           text[] NOT NULL DEFAULT '{report}',  -- 'report' / 'photo' / 'meter'
  starts_on       date NOT NULL,
  ends_on         date,                 -- NULL = 継続中
  created_by      uuid,
  revoked_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- 元請けがアプリを使わない場合の閲覧リンク（ログイン不要・読み取り専用）
CREATE TABLE course_share_links (
  token        text PRIMARY KEY,        -- 十分に長いランダム
  share_id     uuid NOT NULL REFERENCES course_shares(id) ON DELETE CASCADE,
  expires_at   timestamptz,
  last_seen_at timestamptz,
  created_by   uuid
);
```

- **`scope` を必ず持つ**。既定は報告本文のみ。写真やメーターは明示的に足す
- **期間（`starts_on` / `ends_on`）で切る**。契約終了後に過去分まで見え続けないように
- 共有した／見られた事実は監査ログに残す（第三者提供の説明責任）

---

## 3. 届け方は2通り

| 元請けの状態 | 方式 | 課金上の扱い |
|---|---|---|
| 本システムを使う | `to_org_id` を設定 → 元請けの運営画面に該当コースの報告だけ出る | 閲覧専用アカウントを席に数えるか要判断（plans-and-billing §7） |
| 使わない | `course_share_links` のトークン付き URL（読み取り専用）／CSV・PDF エクスポート | 課金対象外 |

トークンリンクは「知っていれば誰でも見られる」ので、**期限必須・失効可能・アクセス記録**の3点をセットにする。

---

## 4. 個人情報の扱い（ここは慎重に）

- 報告に**ドライバー氏名を含めるか**が論点。元請けは「誰が走ったか」を知りたがるが、
  これは第三者提供にあたる可能性がある
- 既定は**含めない**（コース・日付・実績数量のみ）。氏名を出すなら
  `scope` に `driver_name` を足し、**下請け側が明示的に有効化**する形にする
- 顔写真・免許・口座・給与は**どの scope でも共有しない**（コードで遮断する）

---

## 5. 段階

1. **エクスポート（CSV/PDF）** — 一番需要が確実で、モデル変更がほぼ要らない。ここから
2. **トークン閲覧リンク** — 元請けがアプリを使わないケースを吸収
3. **org 間の in-app 共有** — 元請けも導入した段階で
4. **元請け側の承認ワークフロー** — 実需が出てから

---

## 6. 決めたいこと

1. ドライバー氏名を既定で共有するか（本設計は**含めない**を推奨）
2. 元請けの閲覧専用アカウントを課金の席に数えるか（plans-and-billing §7 と同じ論点）
3. 最初に作るのはエクスポートでよいか
