-- ============================================================
-- 招待リンク経由の人がログインできない原因の切り分け（2026-08-05）
--
-- 招待リンク（/api/join）で入った人は **初期PINを発行していない**（§2-1a・PIN撤廃）。
-- ログイン手段は「電話番号のSMS認証」か「Passkey」の2つだけになる。
-- Passkey は identities（人）に紐づくので承認しても引き継がれるが、
-- membership（drivers）が active でないと弾かれる。
--
-- ★これは SELECT のみ。書き込みはしない。
-- ============================================================


-- ------------------------------------------------------------
-- ① 山本さんの状態（PINの有無・コード・承認状態・identity の紐付け）
-- ------------------------------------------------------------
SELECT
  d.id,
  d.name,
  d.status,                              -- active でないと PIN/Passkey いずれもログイン不可
  d.driver_code,                         -- ログインで入力するコード（null なら未発行）
  (d.pin_hash IS NOT NULL) AS has_pin,   -- false = PINログインは使えない（設計どおり）
  d.list_no,
  d.identity_id,                         -- null だと Passkey も SMS も紐付かない
  d.org_id,
  d.created_at
FROM drivers d
WHERE d.name LIKE '山本%';


-- ------------------------------------------------------------
-- ② その identity に Passkey が登録されているか
--    0件 = そもそも登録できていない（登録画面まで到達していない/別端末で登録した）
-- ------------------------------------------------------------
SELECT
  d.name,
  i.phone,
  i.phone_verified_at,                   -- null だと SMS ログインも不可
  COUNT(p.id) AS passkey_count,
  MAX(p.created_at) AS passkey_registered_at,
  MAX(p.last_used_at) AS passkey_last_used_at
FROM drivers d
LEFT JOIN identities i ON i.id = d.identity_id
LEFT JOIN passkey_credentials p ON p.identity_id = d.identity_id
WHERE d.name LIKE '山本%'
GROUP BY d.name, i.phone, i.phone_verified_at;


-- ------------------------------------------------------------
-- ③ 同じ identity に active な membership が2つ以上ないか
--    2件以上あると Passkey ログインは 409（複数所属）で弾かれる
-- ------------------------------------------------------------
SELECT identity_id, COUNT(*) AS active_memberships, array_agg(name) AS names
FROM drivers
WHERE identity_id IS NOT NULL AND status = 'active'
GROUP BY identity_id
HAVING COUNT(*) > 1;


-- ------------------------------------------------------------
-- ④ 招待リンク経由（PINなし）の人の一覧＝ログイン手段が SMS/Passkey しかない人
--    Passkey も電話未確認も無い人は**ログイン不能**なので、運営から案内が要る
-- ------------------------------------------------------------
SELECT
  d.name,
  d.status,
  d.driver_code,
  (d.pin_hash IS NOT NULL) AS has_pin,
  (i.phone_verified_at IS NOT NULL) AS phone_verified,
  COUNT(p.id) AS passkey_count
FROM drivers d
LEFT JOIN identities i ON i.id = d.identity_id
LEFT JOIN passkey_credentials p ON p.identity_id = d.identity_id
WHERE d.pin_hash IS NULL
GROUP BY d.name, d.status, d.driver_code, d.pin_hash, i.phone_verified_at, d.created_at
ORDER BY d.created_at;
