-- sales/reports フィルタ最適化用インデックス
create index if not exists idx_daily_reports_report_date_driver_approved
  on public.daily_reports (report_date, driver_id)
  where approved_at is not null;

create index if not exists idx_shifts_shift_date_driver_course
  on public.shifts (shift_date, driver_id, course_id);

create index if not exists idx_sales_log_entries_log_date_target_driver
  on public.sales_log_entries (log_date, target_driver_id);
