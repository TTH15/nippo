-- ============================================================
-- 集計刷新 Phase1: マスタ（キャリア / unit / unit_fields）
-- 既存テーブルは温存し、新テーブルを追加するのみ。
-- ============================================================

-- キャリア（ヤマト / Amazon / 郵便局 / 企業配 …）
CREATE TABLE IF NOT EXISTS carriers (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL UNIQUE,
  code        text        UNIQUE,            -- 内部コード（請求番号生成・移行参照用）
  sort_order  int         NOT NULL DEFAULT 0,
  active      boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- unit（型 / 集計の単位）
CREATE TABLE IF NOT EXISTS units (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier_id    uuid        NOT NULL REFERENCES carriers(id) ON DELETE CASCADE,
  name          text        NOT NULL,           -- 宅急便 / ネコポス / Amazon-AM …
  code          text,                            -- 移行参照用の安定コード
  billing_type  text        NOT NULL CHECK (billing_type IN ('PER_PIECE', 'FIXED')),
  sort_order    int         NOT NULL DEFAULT 0,
  active        boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (carrier_id, name)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_units_code ON units (code) WHERE code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_units_carrier ON units (carrier_id);

-- unit の報告フィールド定義（型付きビルダー）
CREATE TABLE IF NOT EXISTS unit_fields (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id      uuid        NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  field_key    text        NOT NULL,           -- completed / returned / mochidashi …
  label        text        NOT NULL,           -- 完了個数 / 持戻個数 …
  input_type   text        NOT NULL CHECK (input_type IN ('INT', 'TEXT', 'TIME', 'BOOL')),
  group_label  text,                            -- AM / PM / 4時 などの見出し
  is_billable  boolean     NOT NULL DEFAULT false, -- 従量課金の数量に使うか
  required     boolean     NOT NULL DEFAULT false,
  sort_order   int         NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (unit_id, field_key)
);
CREATE INDEX IF NOT EXISTS idx_unit_fields_unit ON unit_fields (unit_id);

-- courses にキャリア FK を追加（旧 carrier text 列はバックアップとして残置）
ALTER TABLE courses ADD COLUMN IF NOT EXISTS carrier_id uuid REFERENCES carriers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_courses_carrier_id ON courses (carrier_id);
