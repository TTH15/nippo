-- 諸報告（oil_change_reports）一覧のフィルタ/ソート最適化
create index if not exists idx_oil_change_reports_pending_submitted
  on public.oil_change_reports (submitted_at desc)
  where approved_at is null and rejected_at is null;

create index if not exists idx_oil_change_reports_approved_approved_at
  on public.oil_change_reports (approved_at desc)
  where approved_at is not null;

create index if not exists idx_oil_change_reports_driver_id
  on public.oil_change_reports (driver_id);
