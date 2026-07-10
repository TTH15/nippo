import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
import { computeDriverAutoPayout } from '../../server/billing/driverPayout';
import { loadDriverLease, loadCourseDailyLease, computeLeaseDeduction } from '../../server/billing/driverLease';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function main() {
  const orgId = 'feba4f5a-83c4-4d7f-9bc5-7be6bc7248b7'; // AAA
  const driverId = 'c66fc23e-f2e3-40c8-9632-5f398c8e93e5'; // 平石孝也 (dev seed)
  const startDate = '2026-01-01';
  const endDate = '2026-01-31';
  const month = '2026-01';

  const autoPayout = await computeDriverAutoPayout(supabase, orgId, driverId, startDate, endDate);
  const main: { title: string; qty: number; price: number; unit?: string }[] = autoPayout.lines.map((l) => ({
    title: l.title,
    qty: l.qty,
    price: l.unitPrice,
    unit: l.unitId ? '個' : '日',
  }));
  const deduct: { title: string; qty: number; price: number; unit?: string }[] = [];

  const { data: fixedExpRows, error: fixedErr } = await supabase
    .from('driver_fixed_expenses')
    .select('name, amount')
    .eq('driver_id', driverId)
    .eq('cycle', 'MONTHLY')
    .lte('valid_from', endDate)
    .or(`valid_to.is.null,valid_to.gte.${startDate}`);
  if (fixedErr) throw fixedErr;
  (fixedExpRows ?? []).forEach((r: any) => deduct.push({ title: r.name, qty: 1, price: Number(r.amount) || 0, unit: '' }));

  const { data: adHocRows, error: adHocErr } = await supabase
    .from('driver_ad_hoc_expenses')
    .select('name, amount')
    .eq('driver_id', driverId)
    .eq('month', month);
  if (adHocErr) throw adHocErr;
  (adHocRows ?? []).forEach((r: any) => {
    const amount = Number(r.amount) || 0;
    if (amount > 0) deduct.push({ title: r.name, qty: 1, price: amount, unit: '' });
    else if (amount < 0) main.push({ title: `${r.name}（手当）`, qty: 1, price: -amount, unit: '' });
  });

  const [lease, courseDailyLease] = await Promise.all([
    loadDriverLease(supabase, driverId, startDate, endDate),
    loadCourseDailyLease(supabase),
  ]);
  const perDay = autoPayout.days.map((d) => ({ date: d.date, courseId: d.courseId }));
  const leaseDeduction = computeLeaseDeduction(lease, perDay, courseDailyLease);
  if (leaseDeduction > 0) deduct.push({ title: 'リース代', qty: 1, price: leaseDeduction, unit: '' });

  if (main.length === 0) main.push({ title: `平石孝也 ${month}分（明細なし）`, qty: 1, price: 0 });

  console.log(JSON.stringify({ main, deduct }, null, 2));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
