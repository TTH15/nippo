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
const COMPANY_CODE = 'ACE';
const DRY_RUN = process.env.DRY_RUN !== '0';

const master = JSON.parse(fs.readFileSync('/private/tmp/claude-501/-Users-H-Takaya-dev-nippo/8fd19413-bb9b-441d-8ce8-06f770739fe9/scratchpad/master.json', 'utf8'));
const courseById = Object.fromEntries(master.courses.map(c => [c.id, c]));
const unitById = Object.fromEntries(master.units.map(u => [u.id, u]));
const fixedRateByCourse = Object.fromEntries(master.fixedRates.map(r => [r.course_id, r]));
const unitRateByCourseUnit = Object.fromEntries(master.unitRates.map(r => [`${r.course_id}|${r.unit_id}`, r]));

const CP = {
  yorozuya: '7dadbd2c-1423-45fb-babf-48354d9afbe0',
  fiants: '03b493f0-ae3f-4244-94e6-cdfaa40373b0',
  yamashita: 'b690c122-f326-4cd5-949a-c34a28b3b367',
};
const CP_NAME = {
  yorozuya: '株式会社万事屋うっちゃん',
  fiants: '合同会社fiants',
  yamashita: '山下運送',
};
const CP_ADDR = {
  yorozuya: { addr: '〒606-8181<br/>京都府京都市左京区一乗寺地蔵本町6-1', tel: '075-744-6729', reg: 'T3130001077237' },
  fiants: { addr: '〒612-8122<br/>京都府京都市伏見区向島庚申町64-33', tel: '075-205-0224', reg: '' },
  yamashita: { addr: '〒613-0044<br/>京都府久世郡久御山町藤和田馬場崎野15-1 511', tel: '075-631-1018', reg: '' },
};
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
  '梶原優旗': 'b8ebbb05-6dff-4a35-b5ba-2a4f017e87b5',
  '勝政隼人': '154ba01e-fabc-4fbe-9778-899b869984fe',
  '平石孝也': '48bfee2f-cd84-4e86-9b61-b06de52c8606',
  '杉本創都': '330137dd-6404-40f4-a09b-578ca9eabbb1',
  '萩原': '8d07e506-e301-44a8-8afb-f16017d9f538',
};
const driverNameById = Object.fromEntries(Object.entries(DRV).map(([name, id]) => [id, name]));

const ISSUER = {
  name: '株式会社ACE CREATION',
  addr: '〒615-0904<br/>京都市右京区梅津堤上町21 KKハウスⅡ 101',
  tel: '080-9540-4451',
  reg: 'T6130001080238',
  bankName: '京都信用金庫 梅津支店',
  bankNo: '普通 3058832',
  bankHolder: 'カ)エースクリエイション',
};

function periodForMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return `${y}年${m}月1日〜${y}年${m}月${lastDay}日`;
}
function monthRange(ym) {
  const [y, m] = ym.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return { start: `${ym}-01`, end: `${ym}-${String(lastDay).padStart(2, '0')}` };
}
const taxExcl = (v) => Math.round(v / 1.1);

// ---- ad-hoc extras: 明細マスタに対応が無い一時金項目(PDFから手書き転記のまま) ----
const ADHOC_MAIN = {
  'fiants|2025-12': [
    { title: 'モニター案件', qty: 8, unit: '個', price: taxExcl(6000) },
    { title: 'モニター案件', qty: 5, unit: '個', price: taxExcl(14000) },
    { title: 'モニター案件経費（駐車場代）', qty: 1, unit: '件', price: taxExcl(1200) },
  ],
  'fiants|2026-01': [
    { title: '3t横乗り（内海）', qty: 3, unit: '個', price: taxExcl(11000) },
  ],
  'fiants|2026-02': [
    { title: '3t横乗り（内海）', qty: 1, unit: '個', price: 11000 },
    { title: 'モニター案件', qty: 6, unit: '個', price: 6000 },
    { title: '駐車場代', qty: 1, unit: '件', price: 800 },
  ],
  'yamashita|2025-12': [
    { title: '坂田　郵便局', qty: 2, unit: '個', price: 17600 },
    { title: '坂田　郵便局', qty: 1, unit: '個', price: 11000 },
  ],
  'yamashita|2026-01': [
    { title: '横乗り（坂田）', qty: 4, unit: '回', price: 10000 },
  ],
  'yamashita|2026-05': [
    { title: '売上 日本郵便', qty: 3, unit: '個', price: 16000 },
  ],
  'fiants|2025-08': [
    { title: '萩原AMAZON半日', qty: 1, unit: '日', price: 6000 },
  ],
};
const ADHOC_DEDUCT_OUTGOING = {
  'yorozuya|2025-09': [{ title: '振込手数料', qty: 1, unit: '件', price: 660 }],
  'fiants|2025-08': [
    { title: '車輌', qty: 2, unit: '件', price: 35000 },
    { title: 'ガソリン代（萩原）', qty: 1, unit: '件', price: 26209 },
    { title: '振込手数料', qty: 1, unit: '件', price: 770 },
  ],
  'fiants|2025-09': [{ title: '車輌', qty: 1, unit: '件', price: 35000 }, { title: '振込手数料', qty: 1, unit: '件', price: 770 }],
  'fiants|2025-10': [{ title: '振込手数料', qty: 1, unit: '件', price: 770 }],
  'fiants|2025-11': [{ title: '振込手数料', qty: 1, unit: '件', price: 770 }],
  'fiants|2025-12': [{ title: '事務手数料', qty: 1, unit: '件', price: 770 }],
  'fiants|2026-01': [{ title: '事務手数料', qty: 1, unit: '件', price: 770 }],
  'fiants|2026-02': [{ title: '事務手数料', qty: 1, unit: '件', price: 770 }],
  'fiants|2026-03': [{ title: '事務手数料', qty: 1, unit: '件', price: 770 }],
  'yorozuya|2026-03': [
    { title: '勝政隼人　1日リース料金（半日）', qty: 1, unit: '回', price: 800 },
    { title: '勝政隼人　オイル交換費（まとめ）', qty: 1, unit: '件', price: 70 },
  ],
  'yorozuya|2026-04': [
    { title: '勝政隼人　1日リース料金（半日）', qty: 1, unit: '回', price: 800 },
    { title: '勝政隼人　オイル交換費（まとめ）', qty: 1, unit: '件', price: 70 },
    { title: '平石孝也　1日リース料金（半日）', qty: 4, unit: '回', price: 800 },
    { title: '平石孝也　オイル交換費（まとめ）', qty: 1, unit: '件', price: 280 },
    { title: '平石孝也　4/25　リースガソリン補填代金', qty: 1, unit: '件', price: 1000 },
    { title: '猪上泰輝　1日リース料金（半日）', qty: 2, unit: '回', price: 800 },
    { title: '猪上泰輝　オイル交換費（まとめ）', qty: 1, unit: '件', price: 140 },
    { title: '木下楓麻　ヤマト　代品代', qty: 1, unit: '件', price: 7660 },
    { title: '求人広告費用　マイナビスーパー（4月から5月）', qty: 1, unit: '件', price: 100000 },
  ],
};
const ADHOC_DEDUCT_INCOMING = {
  '日笠和哉|2026-04': [
    { title: 'リース代', qty: 1, unit: '台', price: 31818 },
    { title: '事務手数料手数料', qty: 1, unit: '件', price: 3636 },
  ],
};

// ---- CSVの69件(2025-10-08のfiants宛支払を除く) ----
const TARGETS = [];
[
  ['2025-11-10', '2025-09', 129340], ['2025-12-10', '2025-10', 209340], ['2026-01-13', '2025-11', 199340],
  ['2026-02-10', '2025-12', 249340], ['2026-03-10', '2026-01', 257840], ['2026-04-10', '2026-02', 756440],
  ['2026-05-11', '2026-03', 1398310], ['2026-06-10', '2026-04', 1535910],
].forEach(([paidDate, period, amt]) => TARGETS.push({ kind: 'outgoing', cp: 'yorozuya', paidDate, period, amt }));
[
  ['2025-09-30', '2025-08', 488341], ['2025-10-31', '2025-09', 442590], ['2025-11-28', '2025-10', 689740],
  ['2025-12-30', '2025-11', 1119230], ['2026-01-30', '2025-12', 1558590], ['2026-02-27', '2026-01', 957070],
  ['2026-03-31', '2026-02', 1534550], ['2026-04-30', '2026-03', 2692281], ['2026-05-29', '2026-04', 2318140],
  ['2026-06-30', '2026-05', 1497510],
].forEach(([paidDate, period, amt]) => TARGETS.push({ kind: 'outgoing', cp: 'fiants', paidDate, period, amt }));
[
  ['2026-01-23', '2025-12', 46200], ['2026-02-25', '2026-01', 236885], ['2026-06-25', '2026-05', 52800],
].forEach(([paidDate, period, amt]) => TARGETS.push({ kind: 'outgoing', cp: 'yamashita', paidDate, period, amt }));

const DRIVER_PAYMENTS = [
  ['2025-10-31','日笠和哉','2025-09',393210],['2025-10-31','坂田光和','2025-09',69000],
  ['2025-11-28','日笠和哉','2025-10',584244],['2025-11-28','坂田光和','2025-10',99000],['2025-11-30','永戸大心','2025-10',32000],
  ['2025-12-31','日笠和哉','2025-11',497120],['2025-12-31','廣瀬俊斗','2025-11',425380],['2025-12-31','坂田光和','2025-11',120240],['2025-12-31','内海師童','2025-11',82650],['2025-12-31','木戸偲愛','2025-11',45000],
  ['2026-01-31','日笠和哉','2025-12',621824],['2026-01-31','廣瀬俊斗','2025-12',486800],['2026-01-31','坂田光和','2025-12',255280],['2026-01-31','内海師童','2025-12',386248],['2026-01-31','猪上泰輝','2025-12',25000],
  ['2026-02-28','日笠和哉','2026-01',424110],['2026-02-28','廣瀬俊斗','2026-01',379330],['2026-02-28','坂田光和','2026-01',223970],['2026-02-28','内海師童','2026-01',77870],['2026-02-28','木下楓麻','2026-01',312440],['2026-02-28','猪上泰輝','2026-01',80700],
  ['2026-03-31','木下楓麻','2026-02',301310],['2026-03-31','坂田光和','2026-02',200310],['2026-03-31','猪上泰輝','2026-02',176950],['2026-03-31','日笠和哉','2026-02',442534],['2026-03-31','廣瀬俊斗','2026-02',298332],['2026-03-31','島本壮','2026-02',81500],['2026-03-31','梶原優旗','2026-02',145510],
  ['2026-04-30','勝政隼人','2026-03',250770],['2026-04-30','廣瀬俊斗','2026-03',410855],['2026-04-30','木下楓麻','2026-03',380240],['2026-04-30','島本壮','2026-03',165000],['2026-04-30','日笠和哉','2026-03',597050],['2026-04-30','内海師童','2026-03',62900],['2026-04-30','猪上泰輝','2026-03',106997],
  ['2026-05-01','坂田光和','2026-03',342610],['2026-05-01','梶原優旗','2026-03',345550],['2026-05-01','平石孝也','2026-03',166000],
  ['2026-06-09','坂田光和','2026-04',393370],['2026-06-09','勝政隼人','2026-04',346170],
  ['2026-06-10','廣瀬俊斗','2026-04',474910],['2026-06-10','島本壮','2026-04',152000],['2026-06-10','木下楓麻','2026-04',495770],['2026-06-10','梶原優旗','2026-04',402570],['2026-06-10','猪上泰輝','2026-04',49000],['2026-06-10','平石孝也','2026-04',184200],['2026-06-10','日笠和哉','2026-04',519434],
  ['2026-06-24','杉本創都','2026-05',125760], // 実データでは2026-05-18から稼働開始のため'2026-04'から修正
];
DRIVER_PAYMENTS.forEach(([paidDate, name, period, amt]) => TARGETS.push({ kind: 'incoming', driverName: name, paidDate, period, amt }));

console.log('total targets:', TARGETS.length);

// ---- aggregation ----
async function fetchReports({ start, end, courseIds, driverId }) {
  let q = supabase.from('daily_reports_v2').select('id,driver_id,course_id,report_date,approved_at,rejected_at')
    .gte('report_date', start).lte('report_date', end);
  if (courseIds) q = q.in('course_id', courseIds);
  if (driverId) q = q.eq('driver_id', driverId);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []).filter(r => r.approved_at && !r.rejected_at);
}
async function fetchEntries(reportIds) {
  if (!reportIds.length) return [];
  const { data, error } = await supabase.from('report_entries').select('report_id,unit_id,field_key,value_num').in('report_id', reportIds);
  if (error) throw error;
  return data || [];
}
function aggregate(reports, entries, priceKind) {
  const entriesByReport = {};
  for (const e of entries) (entriesByReport[e.report_id] ||= []).push(e);
  const groups = {};
  for (const r of reports) {
    const course = courseById[r.course_id];
    if (!course) continue;
    if (course.carrier === 'AMAZON') {
      const key = `${r.driver_id}|${r.course_id}|FIXED`;
      groups[key] ||= { driverId: r.driver_id, courseId: r.course_id, unitId: null, qty: 0, fixed: true };
      groups[key].qty += 1;
    } else {
      const es = (entriesByReport[r.id] || []).filter(e => e.field_key === 'completed');
      for (const e of es) {
        const key = `${r.driver_id}|${r.course_id}|${e.unit_id}`;
        groups[key] ||= { driverId: r.driver_id, courseId: r.course_id, unitId: e.unit_id, qty: 0, fixed: false };
        groups[key].qty += e.value_num || 0;
      }
    }
  }
  const lines = [];
  for (const g of Object.values(groups)) {
    if (g.qty <= 0) continue;
    const course = courseById[g.courseId];
    const driverName = driverNameById[g.driverId] || '(不明ドライバー)';
    let price = 0;
    if (g.fixed) {
      const fr = fixedRateByCourse[g.courseId];
      price = fr ? (priceKind === 'revenue' ? fr.fixed_revenue : fr.fixed_payout) : 0;
    } else {
      const ur = unitRateByCourseUnit[`${g.courseId}|${g.unitId}`];
      price = ur ? (priceKind === 'revenue' ? ur.revenue_per_unit : ur.payout_per_unit) : 0;
    }
    const unitLabel = g.fixed ? '日' : '個';
    const unitName = g.fixed ? '' : `　${unitById[g.unitId]?.name || ''}`;
    lines.push({ title: `${driverName}　${course.summary_title || course.name}${unitName}`, qty: g.qty, unit: unitLabel, price });
  }
  return lines;
}

// ---- invoice numbering (本番buildInvoiceNo/buildNextInvoiceNoと同一ロジック) ----
function sectionCode(section) {
  if (section === 'Amazon') return 'AMZ';
  if (section === 'ヤマト運輸') return 'YMT';
  return 'PST';
}
function normalizeCounterpartyToken(name) {
  const token = String(name ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  return token || null;
}
async function nextInvoiceNo(prefixBase) {
  const prefix = `${prefixBase}-R`;
  const { data, error } = await supabase.from('invoice_documents').select('invoice_no')
    .eq('org_id', ACE_ORG_ID).like('invoice_no', `${prefix}%`).order('invoice_no', { ascending: false }).limit(100);
  if (error) throw error;
  const maxRevision = (data || []).reduce((max, row) => {
    const m = String(row.invoice_no ?? '').match(new RegExp(`^${prefix.replace(/[-]/g, '\\-')}(\\d{2})$`));
    if (!m) return max;
    const n = Number(m[1]);
    return Number.isFinite(n) ? Math.max(max, n) : max;
  }, -1);
  return `${prefix}${String(maxRevision + 1).padStart(2, '0')}`;
}

const DEFAULT_LAYOUT = { headerGapMm: 4, summaryGapMm: 12, deductGapMm: 10 };
const results = [];
const summary = [];

for (const t of TARGETS) {
  const { start, end } = monthRange(t.period);
  let mainLines, deductLines, toName, toAddr, toTel, toReg, fromName, fromAddr, fromTel, fromReg,
    parties, section, counterpartyId, driverId, clientName, invoiceNoBase;

  if (t.kind === 'outgoing') {
    const courseIds = master.courses.filter(c => c.counterparty_invoice_address_id === CP[t.cp]).map(c => c.id);
    const reports = await fetchReports({ start, end, courseIds });
    const entries = await fetchEntries(reports.map(r => r.id));
    mainLines = aggregate(reports, entries, 'revenue');
    mainLines.push(...(ADHOC_MAIN[`${t.cp}|${t.period}`] || []));
    deductLines = ADHOC_DEDUCT_OUTGOING[`${t.cp}|${t.period}`] || [];
    const addr = CP_ADDR[t.cp];
    toName = CP_NAME[t.cp]; toAddr = addr.addr; toTel = addr.tel; toReg = addr.reg;
    fromName = ISSUER.name; fromAddr = ISSUER.addr; fromTel = ISSUER.tel; fromReg = ISSUER.reg;
    parties = { fromParty: 'ace_creation', toParty: t.cp };
    section = { yorozuya: 'Amazon', fiants: 'ヤマト運輸', yamashita: '郵便局' }[t.cp];
    counterpartyId = CP[t.cp];
    driverId = null;
    clientName = CP_NAME[t.cp];
    invoiceNoBase = (() => {
      const ym = t.period.replace('-', '');
      const sec = sectionCode(section);
      const byName = normalizeCounterpartyToken(clientName);
      const byId = counterpartyId.replace(/-/g, '').slice(0, 4).toUpperCase();
      return `INV-${ym}-${sec}-${byName || byId}`;
    })();
  } else {
    const drv = DRV[t.driverName];
    if (!drv) throw new Error('unknown driver: ' + t.driverName);
    const reports = await fetchReports({ start, end, driverId: drv });
    const entries = await fetchEntries(reports.map(r => r.id));
    mainLines = aggregate(reports, entries, 'payout');
    deductLines = ADHOC_DEDUCT_INCOMING[`${t.driverName}|${t.period}`] || [];
    toName = ISSUER.name; toAddr = ISSUER.addr; toTel = ISSUER.tel; toReg = ISSUER.reg;
    fromName = t.driverName; fromAddr = ''; fromTel = ''; fromReg = '';
    parties = { fromParty: `drv-${drv}`, toParty: 'ace_creation' };
    section = 'Amazon';
    counterpartyId = null;
    driverId = drv;
    clientName = t.driverName;
    invoiceNoBase = (() => {
      const ym = t.period.replace('-', '');
      const idTok = drv.replace(/-/g, '').slice(0, 4).toUpperCase();
      return `IN-${ym}-${idTok}`;
    })();
  }

  const mainTotal = mainLines.reduce((s, l) => s + l.qty * l.price, 0);
  const deductTotal = deductLines.reduce((s, l) => s + l.qty * l.price, 0);
  const computedNet = mainTotal - deductTotal;

  const invoiceNo = await nextInvoiceNo(invoiceNoBase);

  const payload = {
    toName, toAddr, toTel, toReg, honorific: '御中',
    fromName, fromAddr, fromTel, fromReg,
    period: periodForMonth(t.period),
    invoiceNo,
    dueDate: t.paidDate,
    bankName: ISSUER.bankName, bankNo: ISSUER.bankNo, bankHolder: ISSUER.bankHolder,
    notes: `過去請求書のインポート(自動集計。単価・端数はレビューの上で調整してください。実入出金額=${t.amt}円、集計ベース差引額=${computedNet}円)`,
    tableData: { main: mainLines, deduct: deductLines },
    taxSettings: { enabled: true, rate: 10 },
    loanRepay: 0,
    extraOutsourcing: 0,
    blockBreaks: [],
    layout: DEFAULT_LAYOUT,
    parties,
    source: 'historical_import_2026-07-03_v2',
  };

  results.push({
    org_id: ACE_ORG_ID, company_code: COMPANY_CODE, month_yyyy_mm: t.period, section,
    driver_id: driverId, counterparty_invoice_address_id: counterpartyId,
    client_name: clientName, issue_date: t.paidDate, invoice_no: invoiceNo,
    amount: t.amt, status: 'draft', is_starred: true, payload,
  });
  summary.push({ period: t.period, kind: t.kind, who: clientName, invoiceNo, csvAmount: t.amt, computedNet, mainLineCount: mainLines.length });
}

console.log('--- summary ---');
console.table(summary);
fs.writeFileSync('/private/tmp/claude-501/-Users-H-Takaya-dev-nippo/8fd19413-bb9b-441d-8ce8-06f770739fe9/scratchpad/invoice_rows_v2.json', JSON.stringify(results, null, 2));

if (DRY_RUN) {
  console.log('DRY_RUN (default). Set DRY_RUN=0 to actually insert.');
  process.exit(0);
}

const { data, error } = await supabase.from('invoice_documents').insert(results).select('id,invoice_no');
if (error) { console.error('INSERT ERROR', error); process.exit(1); }
console.log(`inserted ${data.length} rows.`);
console.log(JSON.stringify(data, null, 2));
