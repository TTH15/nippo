-- このmigration以降に単回招待リンクから作る申請は、KYCへ進む前にPasskey登録を必須にする。
-- 既存申請と共有参加コード経由の申請は従来どおりに保つ。
alter table public.drivers
  add column if not exists onboarding_requires_passkey boolean not null default false;

comment on column public.drivers.onboarding_requires_passkey is
  '単回招待リンク経由のオンボーディングでPasskey登録を必須にする';
