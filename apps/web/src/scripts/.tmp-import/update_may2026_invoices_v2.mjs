import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
const env = Object.fromEntries(fs.readFileSync(process.env.ENV_FILE,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');let v=l.slice(i+1).trim();if(v.startsWith('"')&&v.endsWith('"'))v=v.slice(1,-1);return [l.slice(0,i),v];}));
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const APPLY = process.argv.includes('--apply');
const START = '2026-05-01';
const END = '2026-05-31';
const MONTH = '2026-05';

// 前回作成した9件のid(このまま更新する。新規行は作らない)
const DRIVERS = [
  { query: '梶原', id: 'b8ebbb05-6dff-4a35-b5ba-2a4f017e87b5', targetId: 'f1b38298-8427-41a1-b499-67b1aa39a62c' },
  { query: '坂田', id: 'c96c534d-3106-40c4-aa90-7f1fbd95c81d', targetId: 'a18c96a5-038d-405e-94ac-687f213faef5' },
  { query: '勝政', id: '154ba01e-fabc-4fbe-9778-899b869984fe', targetId: 'de956a43-5c21-415f-8b9e-99b63c695ed3' },
  { query: '島本', id: '49340a25-5546-4c6e-833c-adbce91c0896', targetId: '86ad82f8-d810-49fa-a394-942d28646aa9' },
  { query: '日笠', id: '93a81a10-3948-4056-b18f-14a96a5319c5', targetId: '92deff96-ae4c-4d89-b470-a97cb4b36af1' },
  { query: '平石', id: '48bfee2f-cd84-4e86-9b61-b06de52c8606', targetId: '03a07f7d-2770-4096-a8ec-5eb22d09ef9f' },
  { query: '猪上', id: 'b1e7473c-d391-4ede-ba6e-00c0b4231a12', targetId: 'afd3c43b-f540-4342-9474-b088652db882' },
  { query: '木下', id: 'ffe3ec6e-946d-4bad-a4f8-4f22046ddbb6', targetId: 'f2d44515-cd83-4236-bd11-2da6b92cf503' },
  { query: '廣瀬', id: '81d9ae34-e1a6-4f7d-8532-724df74d5fa1', targetId: '56640412-bb80-48d7-b139-761f2adaf168' },
];

function shortCourseLabel(name) {
  const t = String(name || '').trim();
  if (!t) return '未設定';
  const m = t.match(/\(([^)]+)\)/);
  return m?.[1] ? m[1] : t;
}

const [{ data: units }, { data: unitFields }, { data: courses }, { data: unitRates }, { data: fixedRates }] = await Promise.all([
  supabase.from('units').select('id, name'),
  supabase.from('unit_fields').select('unit_id, field_key, is_billable'),
  supabase.from('courses').select('id, name'),
  supabase.from('course_unit_rates').select('course_id, unit_id, payout_per_unit'),
  supabase.from('course_fixed_rates').select('course_id, fixed_payout'),
]);
const courseById = new Map(courses.map(c => [c.id, c]));
const unitById = new Map(units.map(u => [u.id, u]));
const billableByUnitField = new Map(unitFields.map(f => [`${f.unit_id}:${f.field_key}`, f.is_billable]));
const rateByCourseUnit = new Map(unitRates.map(r => [`${r.course_id}:${r.unit_id}`, r]));
const fixedByCourse = new Map(fixedRates.map(r => [r.course_id, r]));

const driverIds = DRIVERS.map(d => d.id);
const { data: reports } = await supabase
  .from('daily_reports_v2')
  .select('id, driver_id, report_date, course_id, rejected_at')
  .in('driver_id', driverIds)
  .gte('report_date', START)
  .lte('report_date', END);
const countable = (reports ?? []).filter(r => !r.rejected_at);
const reportIds = countable.map(r => r.id);
const { data: entries } = await supabase.from('report_entries').select('report_id, unit_id, field_key, value_num').in('report_id', reportIds);
const entriesByReport = new Map();
for (const e of entries ?? []) {
  const arr = entriesByReport.get(e.report_id) ?? [];
  arr.push(e);
  entriesByReport.set(e.report_id, arr);
}

const [{ data: fixedExp }, { data: adHoc }] = await Promise.all([
  supabase.from('driver_fixed_expenses').select('driver_id, name, amount, valid_from, valid_to').in('driver_id', driverIds).lte('valid_from', END).or(`valid_to.is.null,valid_to.gte.${START}`),
  supabase.from('driver_ad_hoc_expenses').select('driver_id, name, amount, month').in('driver_id', driverIds).eq('month', MONTH),
]);

const { data: targetRows } = await supabase.from('invoice_documents').select('*').in('id', DRIVERS.map(d => d.targetId));
const targetById = new Map(targetRows.map(r => [r.id, r]));

function computeAmount(main, deduct) {
  const rate = 0.10;
  const rowsTotal = (rows) => {
    const sum = rows.reduce((acc, r) => acc + Math.round(r.qty * r.price), 0);
    const tax = Math.floor(sum * rate);
    return { subtotal: sum, tax, gross: sum + tax };
  };
  const bill = rowsTotal(main);
  const deductT = rowsTotal(deduct);
  return bill.gross - deductT.gross;
}

const results = [];

for (const d of DRIVERS) {
  const target = targetById.get(d.targetId);
  const existingPayload = target.payload ?? {};
  const myReports = countable.filter(r => r.driver_id === d.id);

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

  const main = [];
  for (const [key, qty] of linePuQty) {
    const [courseId, unitId] = key.split(':');
    const rate = rateByCourseUnit.get(key);
    if (!rate || qty <= 0 || rate.payout_per_unit <= 0) continue;
    const course = courseById.get(courseId);
    const unit = unitById.get(unitId);
    const short = shortCourseLabel(course?.name);
    main.push({ title: `${unit?.name ?? ''}（${short}）`, qty, unit: '個', price: rate.payout_per_unit, priceBasis: 'exclusive' });
  }
  for (const [courseId, days] of fixedDaysByCourse) {
    const fx = fixedByCourse.get(courseId);
    const course = courseById.get(courseId);
    const short = shortCourseLabel(course?.name);
    main.push({ title: `${short}（固定）`, qty: days, unit: '日', price: fx.fixed_payout, priceBasis: 'exclusive' });
  }
  main.sort((a, b) => a.title.localeCompare(b.title, 'ja'));

  const myAdHoc = (adHoc ?? []).filter(x => x.driver_id === d.id);
  for (const a of myAdHoc) {
    if (Number(a.amount) < 0) {
      main.push({ title: `${a.name}（手当）`, qty: 1, unit: '', price: -Number(a.amount), priceBasis: 'exclusive' });
    }
  }

  const deduct = [];
  const myFixedExp = (fixedExp ?? []).filter(x => x.driver_id === d.id);
  for (const f of myFixedExp) {
    deduct.push({ title: f.name, qty: 1, unit: '', price: Number(f.amount), priceBasis: 'exclusive' });
  }
  for (const a of myAdHoc) {
    if (Number(a.amount) > 0) {
      deduct.push({ title: a.name, qty: 1, unit: '', price: Number(a.amount), priceBasis: 'exclusive' });
    }
  }

  const amount = computeAmount(main, deduct);

  const payload = {
    ...existingPayload,
    period: '2026年5月1日〜2026年5月31日',
    dueDate: '2026-07-10',
    tableData: { main, deduct },
    displayBasis: 'exclusive',
    taxSettings: { rate: 10, enabled: true },
  };

  results.push({ query: d.query, targetId: d.targetId, amount, oldAmount: target.amount, payload });
}

console.log('=== 更新プレビュー ===');
for (const r of results) {
  console.log(`${r.query}: amount ${r.oldAmount} -> ${r.amount}円  dueDate=${r.payload.dueDate} period=${r.payload.period}`);
}

if (!APPLY) {
  console.log('\n--apply が無いため書き込みは行っていません(プレビューのみ)');
} else {
  console.log('\n=== UPDATE実行 ===');
  for (const r of results) {
    const { error } = await supabase.from('invoice_documents').update({ amount: r.amount, payload: r.payload }).eq('id', r.targetId);
    console.log(`  ${r.query}: ${error ? 'ERROR:' + error.message : 'OK'}`);
  }
}
