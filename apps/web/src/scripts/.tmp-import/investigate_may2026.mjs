import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
const env = Object.fromEntries(fs.readFileSync(process.env.ENV_FILE,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');let v=l.slice(i+1).trim();if(v.startsWith('"')&&v.endsWith('"'))v=v.slice(1,-1);return [l.slice(0,i),v];}));
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const NAMES = ['梶原','坂田','勝政','島本','日笠','平石','猪上','木下','廣瀬'];
const START = '2026-05-01';
const END = '2026-05-31';
const MONTH = '2026-05';

// --- courses に revenue_tax_basis / payout_tax_basis 列が存在するか(migration 101 適用有無) ---
const { data: courseProbe, error: courseProbeErr } = await supabase
  .from('courses')
  .select('id, revenue_tax_basis, payout_tax_basis')
  .limit(1);
console.log('=== migration101 (courses.tax_basis) applied? ===');
console.log(courseProbeErr ? `NOT APPLIED (${courseProbeErr.message})` : 'APPLIED');

// --- drivers ---
const { data: allDrivers } = await supabase.from('drivers').select('id, name, display_name, status, postal_code, address, phone, bank_name, bank_no, bank_holder').order('name');
const matched = [];
for (const nm of NAMES) {
  const hit = (allDrivers ?? []).filter(d => (d.name || '').includes(nm) || (d.display_name || '').includes(nm));
  matched.push({ query: nm, hits: hit });
}
console.log('\n=== driver name matches ===');
for (const m of matched) {
  console.log(`${m.query}: ${m.hits.length} 件`);
  m.hits.forEach(h => console.log(`  - id=${h.id} name=${h.name} display_name=${h.display_name} status=${h.status}`));
}

// --- units / unit_fields / courses / course_unit_rates / course_fixed_rates ---
const [{ data: units }, { data: unitFields }, { data: courses }, { data: unitRates }, { data: fixedRates }, { data: carriers }] = await Promise.all([
  supabase.from('units').select('id, name, carrier_id, billing_type, sort_order'),
  supabase.from('unit_fields').select('unit_id, field_key, label, is_billable, group_label, input_type, sort_order'),
  supabase.from('courses').select('id, name, carrier_id, daily_lease' + (courseProbeErr ? '' : ', revenue_tax_basis, payout_tax_basis')),
  supabase.from('course_unit_rates').select('course_id, unit_id, revenue_per_unit, profit_per_unit, payout_per_unit'),
  supabase.from('course_fixed_rates').select('course_id, fixed_revenue, fixed_profit, fixed_payout'),
  supabase.from('carriers').select('id, name, code'),
]);
const courseById = new Map((courses ?? []).map(c => [c.id, c]));
const unitById = new Map((units ?? []).map(u => [u.id, u]));
const carrierById = new Map((carriers ?? []).map(c => [c.id, c]));
const billableByUnitField = new Map((unitFields ?? []).map(f => [`${f.unit_id}:${f.field_key}`, f.is_billable]));
const rateByCourseUnit = new Map((unitRates ?? []).map(r => [`${r.course_id}:${r.unit_id}`, r]));
const fixedByCourse = new Map((fixedRates ?? []).map(r => [r.course_id, r]));

// --- daily_reports_v2 + report_entries for May 2026 ---
const driverIds = matched.flatMap(m => m.hits.map(h => h.id));
const { data: reports } = await supabase
  .from('daily_reports_v2')
  .select('id, driver_id, report_date, course_id, rejected_at')
  .in('driver_id', driverIds)
  .gte('report_date', START)
  .lte('report_date', END);
const countable = (reports ?? []).filter(r => !r.rejected_at);
const reportIds = countable.map(r => r.id);
let entries = [];
if (reportIds.length) {
  const { data } = await supabase.from('report_entries').select('report_id, unit_id, field_key, value_num').in('report_id', reportIds);
  entries = data ?? [];
}
const entriesByReport = new Map();
for (const e of entries) {
  const arr = entriesByReport.get(e.report_id) ?? [];
  arr.push(e);
  entriesByReport.set(e.report_id, arr);
}

// --- driver_leases / driver_fixed_expenses / driver_ad_hoc_expenses ---
const [{ data: leases }, { data: fixedExp }, { data: adHoc }] = await Promise.all([
  supabase.from('driver_leases').select('driver_id, mode, amount, valid_from, valid_to').in('driver_id', driverIds).lte('valid_from', END).or(`valid_to.is.null,valid_to.gte.${START}`),
  supabase.from('driver_fixed_expenses').select('driver_id, name, amount, cycle, valid_from, valid_to').in('driver_id', driverIds).lte('valid_from', END).or(`valid_to.is.null,valid_to.gte.${START}`),
  supabase.from('driver_ad_hoc_expenses').select('driver_id, name, amount, month').in('driver_id', driverIds).eq('month', MONTH),
]);

// --- per-driver aggregation (same logic as computeDriverAutoPayout) ---
console.log('\n=== per-driver May 2026 breakdown ===');
const roundCandidates = new Map(); // courseId:unitId -> {courseName, unitName, payoutPerUnit}
for (const m of matched) {
  for (const drv of m.hits) {
    const myReports = countable.filter(r => r.driver_id === drv.id);
    if (!myReports.length) {
      console.log(`\n--- ${m.query} (${drv.name} / ${drv.id}) : 5月の日報 0件 ---`);
      continue;
    }
    const linePuQty = new Map();
    const fixedDaysByCourse = new Map();
    for (const r of myReports) {
      const courseId = r.course_id;
      if (!courseId) continue;
      const es = entriesByReport.get(r.id) ?? [];
      for (const e of es) {
        const billable = billableByUnitField.get(`${e.unit_id}:${e.field_key}`);
        const qty = e.value_num ?? 0;
        if (!billable || qty === 0) continue;
        const key = `${courseId}:${e.unit_id}`;
        linePuQty.set(key, (linePuQty.get(key) ?? 0) + qty);
      }
      const fx = fixedByCourse.get(courseId);
      if (fx && (fx.fixed_payout || 0) !== 0) {
        fixedDaysByCourse.set(courseId, (fixedDaysByCourse.get(courseId) ?? 0) + 1);
      }
    }
    console.log(`\n--- ${m.query} (${drv.name} / ${drv.id}) : 稼働${myReports.length}件 ---`);
    let total = 0;
    for (const [key, qty] of linePuQty) {
      const [courseId, unitId] = key.split(':');
      const rate = rateByCourseUnit.get(key);
      if (!rate) { console.log(`  ! rate missing for ${key}`); continue; }
      const course = courseById.get(courseId);
      const unit = unitById.get(unitId);
      const amount = qty * rate.payout_per_unit;
      total += amount;
      const isRound = rate.payout_per_unit > 0 && rate.payout_per_unit % 5 === 0;
      console.log(`  ${course?.name ?? courseId} / ${unit?.name ?? unitId}: qty=${qty} x ${rate.payout_per_unit}円 = ${amount}円${isRound ? '  <-- 端数無し候補' : ''} [payout_tax_basis=${course?.payout_tax_basis ?? 'N/A'}]`);
      if (isRound) roundCandidates.set(key, { courseName: course?.name, unitName: unit?.name, payoutPerUnit: rate.payout_per_unit, payoutTaxBasis: course?.payout_tax_basis });
    }
    for (const [courseId, days] of fixedDaysByCourse) {
      const fx = fixedByCourse.get(courseId);
      const course = courseById.get(courseId);
      const amount = days * fx.fixed_payout;
      total += amount;
      console.log(`  ${course?.name ?? courseId} (固定): ${days}日 x ${fx.fixed_payout}円 = ${amount}円`);
    }
    console.log(`  【自動算出 合計(gross)】 ${total}円`);

    const lease = (leases ?? []).find(l => l.driver_id === drv.id);
    if (lease) console.log(`  リース: mode=${lease.mode} amount=${lease.amount}`);
    const fixedExps = (fixedExp ?? []).filter(x => x.driver_id === drv.id);
    fixedExps.forEach(x => console.log(`  固定経費: ${x.name} ${x.amount}円`));
    const adHocs = (adHoc ?? []).filter(x => x.driver_id === drv.id);
    adHocs.forEach(x => console.log(`  臨時経費: ${x.name} ${x.amount}円`));

    console.log(`  住所=${drv.address} 電話=${drv.phone} 銀行=${drv.bank_name}/${drv.bank_no}/${drv.bank_holder}`);
  }
}

console.log('\n=== 税抜表示だが端数無し(税込疑い)候補 一覧(重複排除) ===');
for (const [key, v] of roundCandidates) {
  console.log(`  ${v.courseName} / ${v.unitName}: payout_per_unit=${v.payoutPerUnit}円 payout_tax_basis=${v.payoutTaxBasis}`);
}

// --- 既存の受領請求書の例を1件確認(フォーマット把握用) ---
const { data: sampleInv } = await supabase
  .from('invoice_documents')
  .select('id, month_yyyy_mm, client_name, invoice_no, amount, status, payload, driver_id')
  .not('driver_id', 'is', null)
  .order('created_at', { ascending: false })
  .limit(2);
console.log('\n=== 既存の受領請求書サンプル(直近2件) ===');
console.log(JSON.stringify(sampleInv, null, 2));
