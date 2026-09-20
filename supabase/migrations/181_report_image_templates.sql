-- ============================================================
-- 日報の原本画像から件数を読むための「様式」。2026-09-19
-- 設計: docs/design/report-image-evidence-2026-09.md（RIMG-1 / RIMG-3）
--
-- 形式を増やすたびにコードを書かないための表。管理画面で
--   「この画面のこの位置に、この報告項目の数字がある」
-- を見本画像の上で決め、読み取り側はそれをデータとして使う。
--
-- 位置は固定ピクセルではなく、見出し文字からの相対と見本座標の補正で持つ。
-- 画面サイズが違ってもトリミングされても同じ値を読み、見出しが切れた項目は
-- 「未取得」にする（0で埋めない）。
--
-- 版（version）を分ける理由: 配送会社の画面が変わっても、確定済みの日報を
-- 後から別の様式で読み直して上書きしないため。読み取り履歴には使った版が残る
-- （report_source_image_readings.template_key / template_version・migration 169）。
-- ============================================================
BEGIN;

CREATE TABLE IF NOT EXISTS public.report_image_templates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- どの荷主の画面か。未指定なら全荷主の候補になる
  carrier_id    uuid REFERENCES public.carriers(id) ON DELETE SET NULL,

  -- 様式の識別子（版をまたいで同じ）。読み取り履歴に残る値
  template_key  text NOT NULL,
  version       int  NOT NULL DEFAULT 1,
  name          text NOT NULL,

  -- draft=編集中（読み取りに使わない） / active=運用中 / retired=停止
  status        text NOT NULL DEFAULT 'draft',

  -- 見分ける見出し・読み取る項目・検算・見本の語（@repo/core の ImageTemplateDefinition）
  definition    jsonb NOT NULL,

  -- 見本画像。管理画面で枠を引き、読み取りの検証に使う
  sample_storage_path text,
  sample_width  int,
  sample_height int,
  sample_mime   text,

  note          text,
  created_by    uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  updated_by    uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  UNIQUE (org_id, template_key, version),
  CONSTRAINT report_image_templates_status_check
    CHECK (status IN ('draft', 'active', 'retired')),
  CONSTRAINT report_image_templates_key_check
    CHECK (template_key ~ '^[a-z0-9][a-z0-9_-]{1,59}$'),
  CONSTRAINT report_image_templates_version_check CHECK (version BETWEEN 1 AND 999),
  CONSTRAINT report_image_templates_name_check CHECK (char_length(name) BETWEEN 1 AND 80),
  CONSTRAINT report_image_templates_note_check CHECK (char_length(coalesce(note, '')) <= 500)
);

-- 運用中の版は様式ごとに1つだけ。どの版で読んだかを曖昧にしない
CREATE UNIQUE INDEX IF NOT EXISTS uq_report_image_templates_active
  ON public.report_image_templates (org_id, template_key) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_report_image_templates_org
  ON public.report_image_templates (org_id, status, carrier_id);

COMMENT ON TABLE public.report_image_templates IS
  '原本画像の様式。どの見出しで見分け、どの位置にどの報告項目の数字があるかを持つ';
COMMENT ON COLUMN public.report_image_templates.definition IS
  '見出し・項目の位置・検算・見本の語。位置は固定ピクセルではなく見出し相対と補正で持つ';
COMMENT ON COLUMN public.report_image_templates.version IS
  '版。画面が変わっても確定済みの日報を別の版で読み直して上書きしないために分ける';

-- 読み取りに使った様式を後から引けるようにする（migration 169 の履歴表）
CREATE INDEX IF NOT EXISTS idx_report_source_image_readings_template
  ON public.report_source_image_readings (org_id, template_key, created_at DESC);

-- 見本画像を置く非公開バケット。原本（report-source-images）とは別にする。
-- 見本は管理者が入れる資料で、保持期間も閲覧範囲も原本と違うため
INSERT INTO storage.buckets (id, name, public)
VALUES ('report-image-template-samples', 'report-image-template-samples', false)
ON CONFLICT (id) DO NOTHING;

REVOKE ALL ON public.report_image_templates FROM PUBLIC, anon, authenticated;

COMMIT;
