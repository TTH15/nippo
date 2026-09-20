-- ============================================================
-- コース単位で「画像から読んだ件数の目視確認を省く」設定。2026-09-20
-- 設計: docs/design/report-image-evidence-2026-09.md
--
-- 件数が報酬に効かないコース（Amazonの日当など）では、読み取った件数を
-- 毎回画像と見比べさせる価値が薄い。そういうコースだけ確認を省けるようにする。
--
-- 省けるのは「悪い兆候は無いが証明もできない」読み取りまで。
-- 合計が合わない・範囲外・裏付けの無い怪しい読みは、この設定に関わらず本人に見せる
-- （@repo/core の canSkipReview）。表の中の関係で裏が取れた読み取りは、この設定と無関係に省く。
-- ============================================================
BEGIN;

ALTER TABLE public.courses
  ADD COLUMN IF NOT EXISTS report_image_auto_fill boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.courses.report_image_auto_fill IS
  '画像から読んだ件数を本人の目視確認なしで日報へ入れてよいコースか。食い違いがある読み取りは対象外';

COMMIT;
