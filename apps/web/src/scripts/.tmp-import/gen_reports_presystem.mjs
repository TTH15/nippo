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
const DRY_RUN = process.env.DRY_RUN !== '0'; // default: dry run. pass DRY_RUN=0 to actually insert.

const DRV = {
  '日笠和哉': '93a81a10-3948-4056-b18f-14a96a5319c5',
  '坂田光和': 'c96c534d-3106-40c4-aa90-7f1fbd95c81d',
  '永戸大心': 'aecb3700-eee8-49d0-888b-f16d18920076',
  '廣瀬俊斗': '81d9ae34-e1a6-4f7d-8532-724df74d5fa1',
  '内海師童': 'e58bd844-02b9-42ff-9df3-360f4ccd4498',
  '木戸偲愛': 'cfe0e3f8-4765-4c2e-aa2a-12de4545dcaf',
  '猪上泰輝': 'b1e7473c-d391-4ede-ba6e-00c0b4231a12',
  '木下楓麻': 'ffe3ec6e-946d-4bad-a4f8-4f22046ddbb6',
  '島本壮': '49340a25-5546-4c6e-833c-adbce91c0896',
  '平石孝也': '48bfee2f-cd84-4e86-9b61-b06de52c8606',
  '前川海輝': '0e882d88-5246-4232-be14-6e786d00b2e2', // 「社員」レコードの本名(既存ドライバー、新規作成しない)
};

const COURSE = {
  amazonMidnight: '0fff17ec-5077-4281-ad7d-87dcb7326ef5', // 万事屋 Amazonミッドナイト
  amazonHiru: 'c48d1974-cf1a-4f67-b8c6-5444a1235ea8',       // 万事屋 Amazon昼 (17000)
  amazonHannichi: '5d1f1a04-8154-41b9-8788-761db126ede0',   // 万事屋 Amazon半日 (8500)
  kamigamo: 'd6f8b619-d3eb-41d3-9cc5-c84254607f5f',         // 万事屋 上賀茂（リース代抜き）(16000)
  yamatoMibu: '67747e27-de4d-46f0-b7f9-4b33f9b5800b',       // 万事屋 ヤマト壬生
  fiantsYokoOji: 'e2d174da-99ef-49af-8464-4c72b1666ae9',    // fiants ヤマト横大路
  fiantsAmazonShain: 'b3680e6e-b26a-4b51-9893-af226eaea854', // fiants Amazonミッドナイト社員用
};
const CARRIER = {
  yamato: '65c66b83-259b-4292-8dfd-5b981421d9ae',
  amazon: '6cc87a69-7c62-4ae8-8e18-ab5cc9a4b0b8',
};
const UNIT = {
  takuhaibin: 'd9ce45f0-b900-4b8a-90af-3d46823f3659',
  nekopos: '4bbade9b-d51a-449c-a700-83a0fe98aee3',
};

function daysInMonth(period) {
  const [y, m] = period.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}
function dateStr(period, day) {
  const [y, m] = period.split('-').map(Number);
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
function splitEvenly(total, n) {
  const base = Math.floor(total / n);
  const rem = total - base * n;
  const arr = new Array(n).fill(base);
  arr[n - 1] += rem;
  return arr;
}
function lastNDays(period, n) {
  const dim = daysInMonth(period);
  const days = [];
  const count = Math.min(n, dim);
  for (let i = 0; i < count; i++) days.push(dim - count + 1 + i);
  return days.map(d => dateStr(period, d));
}

// ---- FIXED (Amazon系: 1レポート=1稼働日) ----
const FIXED_ITEMS = [
  // period, driver, course
  ['2025-10', '坂田光和', 'amazonMidnight', 17],
  ['2025-10', '永戸大心', 'amazonMidnight', 4],
  ['2025-11', '坂田光和', 'amazonMidnight', 11],
  ['2025-11', '永戸大心', 'amazonMidnight', 1],
  ['2025-11', '木戸偲愛', 'amazonMidnight', 8],
  ['2025-12', '坂田光和', 'amazonMidnight', 2],
  ['2025-12', '永戸大心', 'amazonMidnight', 2],
  ['2025-12', '猪上泰輝', 'amazonMidnight', 4],
  ['2025-12', '木戸偲愛', 'amazonMidnight', 17],
  ['2026-01', '坂田光和', 'amazonMidnight', 5],
  ['2026-01', '前川海輝', 'amazonMidnight', 7],
  ['2026-01', '猪上泰輝', 'amazonMidnight', 13],
  ['2026-01', '内海師童', 'amazonHannichi', 1],
  ['2026-02', '坂田光和', 'amazonMidnight', 6],
  ['2026-02', '前川海輝', 'amazonMidnight', 10],
  ['2026-02', '猪上泰輝', 'amazonMidnight', 7],
  ['2026-02', '平石孝也', 'amazonMidnight', 1],
  ['2026-02', '坂田光和', 'kamigamo', 1],
  ['2026-02', '島本壮', 'amazonHiru', 5],
  ['2026-02', '島本壮', 'amazonHannichi', 3],
  ['2025-12', '内海師童', 'fiantsAmazonShain', 1],
];

// ---- PER_PIECE (宅急便/ネコポス個数、月内均等割+端数最終日) ----
// period, driver, course, { takuhaibin: qty, nekopos: qty }
const PIECE_ITEMS = [
  ['2026-02', '木下楓麻', 'yamatoMibu', { takuhaibin: 2255, nekopos: 745 }],
  ['2025-09', '日笠和哉', 'fiantsYokoOji', { takuhaibin: 2748, nekopos: 967 }],
  ['2025-12', '日笠和哉', 'fiantsYokoOji', { takuhaibin: 3543, nekopos: 948 }],
  ['2025-12', '廣瀬俊斗', 'fiantsYokoOji', { takuhaibin: 3370, nekopos: 984 }],
  ['2025-12', '坂田光和', 'fiantsYokoOji', { takuhaibin: 0, nekopos: 166 }],
  ['2025-12', '猪上泰輝', 'fiantsYokoOji', { takuhaibin: 29, nekopos: 1353 }],
  ['2025-12', '内海師童', 'fiantsYokoOji', { takuhaibin: 241, nekopos: 27 }],
  ['2026-01', '内海師童', 'fiantsYokoOji', { takuhaibin: 189, nekopos: 103 }],
  ['2026-01', '廣瀬俊斗', 'fiantsYokoOji', { takuhaibin: 2634, nekopos: 827 }],
  ['2026-01', '日笠和哉', 'fiantsYokoOji', { takuhaibin: 2308, nekopos: 785 }],
  ['2026-01', '坂田光和', 'fiantsYokoOji', { takuhaibin: 190, nekopos: 110 }],
  ['2026-01', '猪上泰輝', 'fiantsYokoOji', { takuhaibin: 0, nekopos: 12 }],
];

const reportsToInsert = []; // { driver_id, report_date, course_id, carrier_id, org_id, approved_at, entries: [{unit_id, field_key, value_num}] }

for (const [period, driverName, courseKey, days] of FIXED_ITEMS) {
  const driverId = DRV[driverName];
  const courseId = COURSE[courseKey];
  if (!driverId || !courseId) throw new Error(`unknown mapping: ${driverName}/${courseKey}`);
  const carrierId = CARRIER.amazon;
  const dates = lastNDays(period, days);
  for (const d of dates) {
    reportsToInsert.push({
      driver_id: driverId, report_date: d, course_id: courseId, carrier_id: carrierId,
      org_id: ACE_ORG_ID, approved_at: `${d}T12:00:00.000Z`, entries: [],
      _tag: `FIXED ${driverName} ${courseKey} ${period}`,
    });
  }
}

for (const [period, driverName, courseKey, qtyMap] of PIECE_ITEMS) {
  const driverId = DRV[driverName];
  const courseId = COURSE[courseKey];
  if (!driverId || !courseId) throw new Error(`unknown mapping: ${driverName}/${courseKey}`);
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
    reportsToInsert.push({
      driver_id: driverId, report_date: d, course_id: courseId, carrier_id: carrierId,
      org_id: ACE_ORG_ID, approved_at: `${d}T12:00:00.000Z`, entries,
      _tag: `PIECE ${driverName} ${courseKey} ${period}`,
    });
  }
}

console.log(`total report rows to create: ${reportsToInsert.length}`);
const byTag = {};
for (const r of reportsToInsert) byTag[r._tag] = (byTag[r._tag] || 0) + 1;
console.log(JSON.stringify(byTag, null, 2));

// sanity: recompute totals per tag group and verify against source qty/days
const verify = {};
for (const r of reportsToInsert) {
  verify[r._tag] ||= { days: 0, takuhaibin: 0, nekopos: 0 };
  verify[r._tag].days += 1;
  for (const e of r.entries) {
    if (e.unit_id === UNIT.takuhaibin) verify[r._tag].takuhaibin += e.value_num;
    if (e.unit_id === UNIT.nekopos) verify[r._tag].nekopos += e.value_num;
  }
}
console.log('--- verify sums ---');
console.log(JSON.stringify(verify, null, 2));

if (DRY_RUN) {
  console.log('DRY_RUN (default). Set DRY_RUN=0 to actually insert.');
  process.exit(0);
}

// actual insert: daily_reports_v2 then report_entries
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
