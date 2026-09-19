-- ============================================================
-- 日報の原本提出（スクリーンショット・写真）の保存基盤。2026-09-17
-- 設計: docs/design/report-image-evidence-2026-09.md（RIMG-2）
--
-- 「原本を出したこと」と「件数が読めたこと」は別の事実なので、状態で区別する。
-- 読めない画像でも原本は受け取り、確認待ちのまま置ける。読めない値を0件で埋めない。
--
-- 日時は4つを混同しない:
--   received_at      サーバーが受け取った時刻（常に記録する）
--   captured_at      画像の作成日時（取れたときだけ。取れなければ NULL のまま）
--   file_modified_at ファイルの更新日時（作成日時の代用にしない）
--   report_date      日報の対象営業日（画像の日時から機械的に決めない）
-- captured_at は端末側で変更できる属性なので、撮影日時の証明としては扱わない。
-- sha256 は「受け取った後に同じファイルか」の照合にだけ使う。
--
-- 添付（report_kind_answers の attachments）とは別の表・別のバケットにする。
-- 報告を消したら添付も消す既存の後始末を、原本の保持へそのまま流用しないため。
-- ============================================================
BEGIN;

CREATE TABLE IF NOT EXISTS public.report_source_images (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- 提出者。代理提出を入れるときは recorded_by を別に足す
  driver_id     uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  report_date   date NOT NULL,
  course_id     uuid REFERENCES public.courses(id) ON DELETE SET NULL,

  -- 受領したバイト列そのもの（再圧縮・回転・切り抜きをしない）。表示用・OCR用は派生物
  storage_path  text NOT NULL,
  sha256        text NOT NULL,
  byte_size     bigint NOT NULL,
  -- 申告 MIME ではなく中身から判定したもの
  mime          text NOT NULL,
  width         int,
  height        int,
  original_filename text,

  received_at   timestamptz NOT NULL DEFAULT now(),
  captured_at   timestamptz,
  -- exif=画像内メタデータ / photo_library=写真ライブラリ / unknown=取得できなかった
  captured_at_source text NOT NULL DEFAULT 'unknown',
  file_modified_at timestamptz,

  -- received=原本のみ / reading=読み取り中 / needs_review=件数の確認待ち
  -- confirmed=本人が確認して確定 / unsupported=未対応形式 / failed=読み取り失敗
  status        text NOT NULL DEFAULT 'received',
  -- 訂正は差し替えず、新しい提出を足して旧版を指す
  supersedes_id uuid REFERENCES public.report_source_images(id) ON DELETE SET NULL,
  -- 同じ提出の再送を二重登録しない
  client_key    text NOT NULL,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  UNIQUE (org_id, driver_id, client_key),
  CONSTRAINT report_source_images_status_check
    CHECK (status IN ('received', 'reading', 'needs_review', 'confirmed', 'unsupported', 'failed')),
  CONSTRAINT report_source_images_captured_source_check
    CHECK (captured_at_source IN ('exif', 'photo_library', 'unknown')),
  -- 取得元が unknown なら作成日時は持たない（現在時刻を作成日時として捏造しない）
  CONSTRAINT report_source_images_captured_consistency_check
    CHECK ((captured_at_source = 'unknown' AND captured_at IS NULL) OR (captured_at_source <> 'unknown' AND captured_at IS NOT NULL)),
  CONSTRAINT report_source_images_sha_check CHECK (char_length(sha256) = 64),
  CONSTRAINT report_source_images_size_check CHECK (byte_size > 0 AND byte_size <= 50000000),
  CONSTRAINT report_source_images_filename_check CHECK (char_length(coalesce(original_filename, '')) <= 200),
  CONSTRAINT report_source_images_client_key_check CHECK (char_length(client_key) BETWEEN 1 AND 64)
);

CREATE INDEX IF NOT EXISTS idx_report_source_images_org_date
  ON public.report_source_images (org_id, report_date DESC);
CREATE INDEX IF NOT EXISTS idx_report_source_images_driver
  ON public.report_source_images (driver_id, report_date DESC);
-- 同じ原本の再提出（別日・別人への流用を含む）を見つけるため
CREATE INDEX IF NOT EXISTS idx_report_source_images_sha
  ON public.report_source_images (org_id, sha256);

COMMENT ON TABLE public.report_source_images IS
  '日報の原本画像。受領したファイルそのものを非公開で保持する。OCRの成否とは独立';
COMMENT ON COLUMN public.report_source_images.captured_at IS
  '画像の作成日時。端末で変更できる属性であり、撮影日時の証明ではない';
COMMENT ON COLUMN public.report_source_images.sha256 IS
  'サーバー計算。受領後に同じファイルかの照合に使う。内容の真実性は保証しない';
COMMENT ON COLUMN public.report_source_images.supersedes_id IS
  '訂正で置き換えた前の提出。原本は差し替えず、関係だけを残す';

-- 読み取りと確認の履歴。抽出値と本人が直した値を別に持ち、集計へ採用した版を記録する
CREATE TABLE IF NOT EXISTS public.report_source_image_readings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  source_image_id uuid NOT NULL REFERENCES public.report_source_images(id) ON DELETE CASCADE,
  -- 読み取りに使った様式と版。確定済み日報を再OCRで自動上書きしないため版を残す
  template_key    text,
  template_version text,
  extracted       jsonb,
  corrected       jsonb,
  confirmed_by    uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  confirmed_at    timestamptz,
  -- 集計・報酬・請求へ反映した版
  adopted         boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT report_source_image_readings_template_check
    CHECK (char_length(coalesce(template_key, '')) <= 60 AND char_length(coalesce(template_version, '')) <= 30),
  -- 確定した版は誰がいつ確認したかを伴う
  CONSTRAINT report_source_image_readings_adopted_check
    CHECK (NOT adopted OR (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_report_source_image_readings_image
  ON public.report_source_image_readings (source_image_id, created_at DESC);
-- 1つの原本で集計へ採用するのは1版だけ
CREATE UNIQUE INDEX IF NOT EXISTS uq_report_source_image_readings_adopted
  ON public.report_source_image_readings (source_image_id) WHERE adopted;

COMMENT ON TABLE public.report_source_image_readings IS
  'OCRの抽出値と本人の確認後の値。確定した値だけを既存の集計へ渡す';

-- 原本を置く非公開バケット。添付（report-attachments）とは保持方針が違うので分ける
INSERT INTO storage.buckets (id, name, public)
VALUES ('report-source-images', 'report-source-images', false)
ON CONFLICT (id) DO NOTHING;

REVOKE ALL ON public.report_source_images FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.report_source_image_readings FROM PUBLIC, anon, authenticated;

COMMIT;
