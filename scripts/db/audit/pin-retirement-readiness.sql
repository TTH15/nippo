-- 個人情報・番号・ハッシュを出力せず、本番切替の条件を件数で確認する。
SELECT d.role, count(*) AS active_members,
 count(*) FILTER(WHERE d.pin_hash IS NOT NULL) AS stored_password_or_pin,
 count(*) FILTER(WHERE i.phone_verified_at IS NOT NULL AND NULLIF(i.phone,'') IS NOT NULL) AS sms_ready,
 count(*) FILTER(WHERE EXISTS(SELECT 1 FROM public.passkey_credentials p WHERE p.identity_id=d.identity_id)) AS passkey_ready,
 count(*) FILTER(WHERE (i.phone_verified_at IS NULL OR NULLIF(i.phone,'') IS NULL)
   AND NOT EXISTS(SELECT 1 FROM public.passkey_credentials p WHERE p.identity_id=d.identity_id)) AS no_alternative
FROM public.drivers d LEFT JOIN public.identities i ON i.id=d.identity_id
WHERE d.status='active' GROUP BY d.role ORDER BY d.role;
