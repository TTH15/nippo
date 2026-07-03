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
  '日笠和哉': '93a81a10-3948-4056-b18f-14a96a5319c5',
  '萩原': '8d07e506-e301-44a8-8afb-f16017d9f538',
};
const COURSE = { fiantsYokoOji: 'e2d174da-99ef-49af-8464-4c72b1666ae9', fiantsAmazonShain: 'b3680e6e-b26a-4b51-9893-af226eaea854' };
const CARRIER = { yamato: '65c66b83-259b-4292-8dfd-5b981421d9ae', amazon: '6cc87a69-7c62-4ae8-8e18-ab5cc9a4b0b8' };
const UNIT = { takuhaibin: 'd9ce45f0-b900-4b8a-90af-3d46823f3659', nekopos: '4bbade9b-d51a-449c-a700-83a0fe98aee3' };

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

// fiants 2025-08 (202508 PDF発見): 日笠 宅急便/ネコポス、萩原 Amazon 8日(半日1日は単価不明の別コースのためad-hoc扱い)
{
  const period = '2025-08', driverId = DRV['日笠和哉'], courseId = COURSE.fiantsYokoOji, carrierId = CARRIER.yamato;
  const n = daysInMonth(period);
  const takuhaibinDaily = splitEvenly(2589, n);
  const nekoposDaily = splitEvenly(1047, n);
  for (let i = 0; i < n; i++) {
    const d = dateStr(period, i + 1);
    reportsToInsert.push({
      driver_id: driverId, report_date: d, course_id: courseId, carrier_id: carrierId, org_id: ACE_ORG_ID,
      approved_at: `${d}T12:00:00.000Z`,
      entries: [
        { unit_id: UNIT.takuhaibin, field_key: 'completed', value_num: takuhaibinDaily[i] },
        { unit_id: UNIT.nekopos, field_key: 'completed', value_num: nekoposDaily[i] },
      ],
      _tag: 'PIECE 日笠和哉 fiantsYokoOji 2025-08',
    });
  }
}
for (const d of lastNDays('2025-08', 8)) {
  reportsToInsert.push({ driver_id: DRV['萩原'], report_date: d, course_id: COURSE.fiantsAmazonShain, carrier_id: CARRIER.amazon, org_id: ACE_ORG_ID, approved_at: `${d}T12:00:00.000Z`, entries: [], _tag: 'FIXED 萩原 fiantsAmazonShain 2025-08' });
}

console.log(`total report rows to create: ${reportsToInsert.length}`);
const verify = {};
for (const r of reportsToInsert) {
  verify[r._tag] ||= { days: 0, takuhaibin: 0, nekopos: 0 };
  verify[r._tag].days += 1;
  for (const e of r.entries) {
    if (e.unit_id === UNIT.takuhaibin) verify[r._tag].takuhaibin += e.value_num;
    if (e.unit_id === UNIT.nekopos) verify[r._tag].nekopos += e.value_num;
  }
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
