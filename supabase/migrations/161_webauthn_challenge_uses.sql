-- 使用済みチャレンジだけを短期間記録し、counter=0 のPasskeyでも再送を防ぐ。
-- 160 は駐車位置自動特定の設計で予約済み。
SET LOCAL lock_timeout = '3s';

CREATE TABLE IF NOT EXISTS public.webauthn_challenge_uses (
  challenge_hash text PRIMARY KEY CHECK (challenge_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS webauthn_challenge_uses_expiry
  ON public.webauthn_challenge_uses (expires_at);

REVOKE ALL ON TABLE public.webauthn_challenge_uses FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.webauthn_challenge_uses TO service_role;

CREATE OR REPLACE FUNCTION public.consume_webauthn_challenge(
  p_challenge_hash text,
  p_expires_at timestamptz
) RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  consumed boolean;
BEGIN
  IF p_challenge_hash IS NULL OR p_challenge_hash !~ '^[0-9a-f]{64}$'
     OR p_expires_at IS NULL OR p_expires_at <= clock_timestamp()
     OR p_expires_at > clock_timestamp() + interval '5 minutes' THEN
    RETURN false;
  END IF;

  DELETE FROM public.webauthn_challenge_uses WHERE expires_at <= clock_timestamp();
  INSERT INTO public.webauthn_challenge_uses (challenge_hash, expires_at)
    VALUES (p_challenge_hash, p_expires_at)
    ON CONFLICT (challenge_hash) DO NOTHING
    -- ロック待ちや期限切れ行の削除中に期限を超えた場合も成功にしない。
    RETURNING expires_at > clock_timestamp() INTO consumed;
  RETURN COALESCE(consumed, false);
END;
$$;

REVOKE ALL ON FUNCTION public.consume_webauthn_challenge(text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_webauthn_challenge(text, timestamptz)
  TO service_role;
