import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const env = Object.fromEntries(
  fs.readFileSync(process.env.ENV_FILE, 'utf8').split('\n').filter(l => l.includes('=')).map(l => {
    const i = l.indexOf('=');
    let v = l.slice(i + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    return [l.slice(0, i), v];
  })
);
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const ACE_ORG_ID = '1314c7a1-0f86-44fd-8f60-01588735295a';
const DRY_RUN = process.env.DRY_RUN !== '0';

const DRV = {
  '坂田光和': 'c96c534d-3106-40c4-aa90-7f1fbd95c81d',
  '永戸大心': 'aecb3700-eee8-49d0-888b-f16d18920076',
};
const COURSE = {
  amazonMidnight: '0fff17ec-5077-4281-ad7d-87dcb7326ef5', // 万事屋 Amazonミッドナイト
  postOffice: '988bbf82-d6b9-4a34-a182-01d12b720aab',      // 山下運送 郵便局
};
const CARRIER = { amazon: '6cc87a69-7c62-4ae8-8e18-ab5cc9a4b0b8', other: 'c92ced9e-88ea-4d0f-b2c3-9079d7608566' };
const UNIT = { postTaku: '5ec1a17a-55d6-4ce1-9b02-adf7b7bfac03' };

function daysInMonth(period) { const [y, m] = period.split('-').map(Number); return new Date(y, m, 0).getDate(); }
function dateStr(period, day) { const [y, m] = period.split('-').map(Number); return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`; }
function splitEvenly(total, n) { const base = Math.floor(total / n); const rem = total - base * n; const arr = new Array(n).fill(base); arr[n - 1] += rem; return arr; }
function lastNDays(period, n) {
  const dim = daysInMonth(period);
  const count = Math.min(n, dim);
  const days = [];
  for (let i = 0; i < count; i++) days.push(dim - count + 1 + i);
  return days.map(d => dateStr(period, d));
}

const reportsToInsert = [];

// 万事屋 2025-09 (202509 PDF発見): 坂田12日, 永戸1日 Amazonミッドナイト
for (const [driverName, days] of [['坂田光和', 12], ['永戸大心', 1]]) {
  const dates = lastNDays('2025-09', days);
  for (const d of dates) {
    reportsToInsert.push({ driver_id: DRV[driverName], report_date: d, course_id: COURSE.amazonMidnight, carrier_id: CARRIER.amazon, org_id: ACE_ORG_ID, approved_at: `${d}T12:00:00.000Z`, entries: [], _tag: `FIXED ${driverName} amazonMidnight 2025-09` });
  }
}

// 山下運送 2026-01 (三訂版PDF発見): 坂田 郵便局宅急便 1169個(横乗り4回はad-hoc扱い、別途)
{
  const period = '2026-01', driverName = '坂田光和', total = 1169;
  const n = daysInMonth(period);
  const daily = splitEvenly(total, n);
  for (let i = 0; i < n; i++) {
    if (daily[i] <= 0) continue;
    const d = dateStr(period, i + 1);
    reportsToInsert.push({
      driver_id: DRV[driverName], report_date: d, course_id: COURSE.postOffice, carrier_id: CARRIER.other, org_id: ACE_ORG_ID,
      approved_at: `${d}T12:00:00.000Z`, entries: [{ unit_id: UNIT.postTaku, field_key: 'completed', value_num: daily[i] }],
      _tag: `PIECE ${driverName} postOffice ${period}`,
    });
  }
}

console.log(`total report rows to create: ${reportsToInsert.length}`);
const verify = {};
for (const r of reportsToInsert) {
  verify[r._tag] ||= { days: 0, qty: 0 };
  verify[r._tag].days += 1;
  for (const e of r.entries) verify[r._tag].qty += e.value_num;
}
console.log(JSON.stringify(verify, null, 2));

if (DRY_RUN) { console.log('DRY_RUN (default). Set DRY_RUN=0 to actually insert.'); process.exit(0); }

let inserted = 0;
for (const r of reportsToInsert) {
  const { data: rep, error: repErr } = await supabase.from('daily_reports_v2').insert({
    driver_id: r.driver_id, report_date: r.report_date, course_id: r.course_id, carrier_id: r.carrier_id,
    org_id: r.org_id, submitted_at: r.approved_at, approved_at: r.approved_at,
  }).select('id').single();
  if (repErr) { console.error('REPORT INSERT ERROR', r._tag, r.report_date, repErr); process.exit(1); }
  if (r.entries.length > 0) {
    const entryRows = r.entries.map(e => ({ report_id: rep.id, unit_id: e.unit_id, field_key: e.field_key, value_num: e.value_num }));
    const { error: entErr } = await supabase.from('report_entries').insert(entryRows);
    if (entErr) { console.error('ENTRY INSERT ERROR', r._tag, r.report_date, entErr); process.exit(1); }
  }
  inserted += 1;
}
console.log(`inserted ${inserted} daily_reports_v2 rows (+ entries).`);
