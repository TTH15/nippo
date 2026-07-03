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
  '梶原優旗': 'b8ebbb05-6dff-4a35-b5ba-2a4f017e87b5',
  '猪上泰輝': 'b1e7473c-d391-4ede-ba6e-00c0b4231a12',
  '廣瀬俊斗': '81d9ae34-e1a6-4f7d-8532-724df74d5fa1',
  '勝政隼人': '154ba01e-fabc-4fbe-9778-899b869984fe',
  '日笠和哉': '93a81a10-3948-4056-b18f-14a96a5319c5',
  '坂田光和': 'c96c534d-3106-40c4-aa90-7f1fbd95c81d',
};
const COURSE = { fiantsYokoOji: 'e2d174da-99ef-49af-8464-4c72b1666ae9' };
const CARRIER = { yamato: '65c66b83-259b-4292-8dfd-5b981421d9ae' };
const UNIT = { takuhaibin: 'd9ce45f0-b900-4b8a-90af-3d46823f3659', nekopos: '4bbade9b-d51a-449c-a700-83a0fe98aee3' };

function daysInMonth(period) { const [y, m] = period.split('-').map(Number); return new Date(y, m, 0).getDate(); }
function dateStr(period, day) { const [y, m] = period.split('-').map(Number); return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`; }
function splitEvenly(total, n) { const base = Math.floor(total / n); const rem = total - base * n; const arr = new Array(n).fill(base); arr[n - 1] += rem; return arr; }

// fiants 202602 PDF発見(2026-02稼働分) により追加
const PIECE_ITEMS = [
  ['2026-02', '梶原優旗', 'fiantsYokoOji', { takuhaibin: 1087, nekopos: 382 }],
  ['2026-02', '猪上泰輝', 'fiantsYokoOji', { takuhaibin: 1048, nekopos: 366 }],
  ['2026-02', '廣瀬俊斗', 'fiantsYokoOji', { takuhaibin: 2231, nekopos: 762 }],
  ['2026-02', '勝政隼人', 'fiantsYokoOji', { takuhaibin: 78, nekopos: 19 }],
  ['2026-02', '日笠和哉', 'fiantsYokoOji', { takuhaibin: 2743, nekopos: 1154 }],
  ['2026-02', '坂田光和', 'fiantsYokoOji', { takuhaibin: 1306, nekopos: 533 }],
];

const reportsToInsert = [];
for (const [period, driverName, courseKey, qtyMap] of PIECE_ITEMS) {
  const driverId = DRV[driverName];
  const courseId = COURSE[courseKey];
  const carrierId = CARRIER.yamato;
  const n = daysInMonth(period);
  const takuhaibinDaily = qtyMap.takuhaibin ? splitEvenly(qtyMap.takuhaibin, n) : new Array(n).fill(0);
  const nekoposDaily = qtyMap.nekopos ? splitEvenly(qtyMap.nekopos, n) : new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const entries = [];
    if (takuhaibinDaily[i] > 0) entries.push({ unit_id: UNIT.takuhaibin, field_key: 'completed', value_num: takuhaibinDaily[i] });
    if (nekoposDaily[i] > 0) entries.push({ unit_id: UNIT.nekopos, field_key: 'completed', value_num: nekoposDaily[i] });
    if (entries.length === 0) continue;
    const d = dateStr(period, i + 1);
    reportsToInsert.push({ driver_id: driverId, report_date: d, course_id: courseId, carrier_id: carrierId, org_id: ACE_ORG_ID, approved_at: `${d}T12:00:00.000Z`, entries, _tag: `PIECE ${driverName} ${courseKey} ${period}` });
  }
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
