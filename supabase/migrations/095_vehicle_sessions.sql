-- ============================================================
-- 車両セッション（チェックイン→利用→チェックアウト）— 背骨
-- 車両の乗り込み〜返却を1つの「セッション」として記録する。
--   vehicle_sessions          : 出勤(open)→退勤(closed) の両端。目的/オドメーター/位置/打刻手段。
--   vehicle_inspections       : 稼働前(pre)/後(post) のオドメーター・状態点検。
--   vehicle_inspection_photos : 点検の角度別写真（前後左右/4角/8点）。
-- 追加のみ・既存挙動不変。冪等（IF NOT EXISTS）。RLS不使用＝アプリ層 org_id スコープ（platform-design §4）。
--   設計: docs/vehicle-session-flow.md §1,§3,§7,§8.5,§9,§10 / docs/platform-design.md §5
-- ============================================================

-- ---- セッション本体（勤怠の正本） --------------------------------
CREATE TABLE IF NOT EXISTS vehicle_sessions (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id    uuid        NOT NULL REFERENCES vehicles(id),
  org_id        uuid        NOT NULL REFERENCES organizations(id),  -- 使用org（貸与中は借用org）
  recorded_by   uuid        REFERENCES drivers(id) ON DELETE SET NULL,  -- membership（記録者＝ドライバー）
  purpose       text        NOT NULL DEFAULT 'work'
                            CHECK (purpose IN ('work', 'move', 'private')),  -- 稼働/移動・整備/私用（§4）
  shift_id      uuid        REFERENCES shifts(id) ON DELETE SET NULL,    -- work時に紐付け（任意・シフト外稼働も可）
  authorized_by uuid        REFERENCES drivers(id) ON DELETE SET NULL,   -- private時の承認者

  status        text        NOT NULL DEFAULT 'open'
                            CHECK (status IN ('open', 'closed')),         -- open=稼働中（未返却）

  -- 出勤（チェックイン）: QRが先頭（§2）
  started_at    timestamptz,
  start_lat     double precision,
  start_lng     double precision,
  start_odometer integer,
  start_method  text        DEFAULT 'qr'
                            CHECK (start_method IN ('qr', 'plate_ocr', 'manual')),  -- 打刻手段（§8.5）
  start_gps_status text     CHECK (start_gps_status IN ('captured', 'denied', 'unavailable')),  -- §9

  -- 退勤（チェックアウト）: 諸入力の後、最後にQRで確定（§3-0）
  ended_at      timestamptz,
  end_lat       double precision,
  end_lng       double precision,
  end_odometer  integer,
  end_method    text        DEFAULT 'qr'
                            CHECK (end_method IN ('qr', 'plate_ocr', 'manual')),
  end_gps_status text       CHECK (end_gps_status IN ('captured', 'denied', 'unavailable')),

  -- 退避ルートの証跡（plate_ocr / manual のとき。§8.5）
  fallback_reason  text,                  -- QRが使えなかった理由（任意）
  plate_photo_path text,                  -- ナンバープレート写真（plate_ocr時の証跡）

  -- manual打刻は運営承認制（§8.5）。null=承認不要（qr/plate_ocr）。
  approval_status text       CHECK (approval_status IN ('pending', 'approved', 'rejected')),
  approved_at     timestamptz,
  approved_by     uuid       REFERENCES drivers(id) ON DELETE SET NULL,

  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vehicle_sessions_vehicle    ON vehicle_sessions (vehicle_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_vehicle_sessions_org_status ON vehicle_sessions (org_id, status);  -- 運営マップ＝openなセッション
CREATE INDEX IF NOT EXISTS idx_vehicle_sessions_driver     ON vehicle_sessions (recorded_by);     -- ドライバー別走行距離の派生集計（§7）

COMMENT ON TABLE  vehicle_sessions IS '車両セッション（出勤open→退勤closed）。勤怠の正本。打刻手段/GPS状態/退避証跡/manual承認を含む';
COMMENT ON COLUMN vehicle_sessions.org_id IS '使用org（貸与中は借用org）。QRはグローバル解決・認可は所有org or 有効貸与（vehicle-session-flow §8.1,§13）';

-- ---- 点検（オドメーター＋状態写真） ------------------------------
CREATE TABLE IF NOT EXISTS vehicle_inspections (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    uuid        REFERENCES vehicle_sessions(id) ON DELETE SET NULL,
  vehicle_id    uuid        NOT NULL REFERENCES vehicles(id),
  org_id        uuid        NOT NULL REFERENCES organizations(id),
  recorded_by   uuid        REFERENCES drivers(id) ON DELETE SET NULL,
  phase         text        NOT NULL CHECK (phase IN ('pre', 'post')),  -- 稼働前/後（新規損傷の比較）

  odometer_reading      integer,
  odometer_photo_path   text,         -- 写真が真実・誤読は手修正（§7）
  -- オドメーター写真は「運営承認まで必須保持→承認後ティア削除」（§7,§11）。
  -- cleanup ジョブがこの期日を見て削除（null=未確定／承認まで保持）。
  odometer_photo_retain_until timestamptz,

  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vehicle_inspections_vehicle ON vehicle_inspections (vehicle_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vehicle_inspections_session ON vehicle_inspections (session_id);

COMMENT ON TABLE vehicle_inspections IS '稼働前後の点検（オドメーター＋状態写真）。要否はドライバー単位×車両単位の両軸・厳しい方優先（§6）';

-- ---- 点検写真（角度別） ------------------------------------------
CREATE TABLE IF NOT EXISTS vehicle_inspection_photos (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id uuid        NOT NULL REFERENCES vehicle_inspections(id) ON DELETE CASCADE,
  angle         text        NOT NULL,   -- 'front' | 'rear' | 'left' | 'right' | 'corner_fl' ... 撮影セット依存
  photo_path    text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vehicle_inspection_photos_inspection ON vehicle_inspection_photos (inspection_id);

-- ドライバー別 走行距離の累計は派生指標（専用テーブルなし。§7）:
--   SUM(end_odometer - start_odometer) GROUP BY recorded_by。負値/巻き戻し/欠損はアプリ側でガード。
