-- ============================================================
-- ナンバープレートの色（2026-08-14）
--
-- 実物の4種（white=普通自家用 / green=普通事業用 / yellow=軽自家用 / black=軽事業用）を
-- データと描画は最初から持ち、選択 UI は当面 black のみ活性にする
-- （将来リース車両等で白ナンバーが入っても migration なしで開けられる）。
-- 既存車両は全て軽事業（黒）なので DEFAULT 'black' = 表示変化なし。
-- black のときの かな は「り」「れ」の2択（軽貨物事業用の割当。UI 側で制御し、
-- 旧データの他のかなは温存する＝サーバーでは強制しない）。
-- 追加のみ・冪等。
-- ============================================================

ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS plate_color text NOT NULL DEFAULT 'black';

ALTER TABLE vehicles DROP CONSTRAINT IF EXISTS vehicles_plate_color_check;
ALTER TABLE vehicles ADD CONSTRAINT vehicles_plate_color_check
  CHECK (plate_color IN ('white', 'yellow', 'green', 'black'));

COMMENT ON COLUMN vehicles.plate_color IS
  'ナンバープレートの色。white=普通自家用/green=普通事業用/yellow=軽自家用/black=軽事業用（当面はUIでblackのみ選択可）';
