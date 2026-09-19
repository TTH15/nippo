-- B-6切替用。SMS/Passkeyの移行とモバイル配布を確認してから適用する。
-- 運営パスワードと既存セッションは維持する。ロールが変わる競合を防いで判定・更新する。
SET LOCAL lock_timeout = '3s';
LOCK TABLE public.drivers, public.identities, public.passkey_credentials IN SHARE ROW EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.drivers d LEFT JOIN public.identities i ON i.id=d.identity_id
    WHERE d.status='active' AND d.role='DRIVER'
      AND (i.phone_verified_at IS NULL OR NULLIF(i.phone,'') IS NULL)
      AND NOT EXISTS(SELECT 1 FROM public.passkey_credentials p WHERE p.identity_id=d.identity_id)
  ) THEN RAISE EXCEPTION 'PIN retirement blocked: active drivers need verified SMS or Passkey'; END IF;
END $$;
UPDATE public.drivers SET pin_hash=NULL WHERE role IN ('DRIVER','PENDING') AND pin_hash IS NOT NULL;
UPDATE public.identities i SET pin_hash=NULL WHERE pin_hash IS NOT NULL
  AND EXISTS(SELECT 1 FROM public.drivers d WHERE d.identity_id=i.id)
  AND NOT EXISTS(SELECT 1 FROM public.drivers d WHERE d.identity_id=i.id AND d.role NOT IN ('DRIVER','PENDING'));
