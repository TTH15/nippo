import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
const env = Object.fromEntries(fs.readFileSync(process.env.ENV_FILE,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');let v=l.slice(i+1).trim();if(v.startsWith('"')&&v.endsWith('"'))v=v.slice(1,-1);return [l.slice(0,i),v];}));
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const APPLY = process.argv.includes('--apply');
const START = '2026-05-01';
const END = '2026-05-31';
const MONTH = '2026-05';

const DRIVERS = [
  { query: '梶原', id: 'b8ebbb05-6dff-4a35-b5ba-2a4f017e87b5', existingId: '5c38127a-9757-4ff6-a1da-cc227ea211e5' },
  { query: '坂田', id: 'c96c534d-3106-40c4-aa90-7f1fbd95c81d', existingId: 'fe6e3e39-9bd1-4f76-bfe8-80c9f51317e2' },
  { query: '勝政', id: '154ba01e-fabc-4fbe-9778-899b869984fe', existingId: 'edc42d72-6775-4556-ba11-710bc3cda39b' }, // 最新=R02 draft
  { query: '島本', id: '49340a25-5546-4c6e-833c-adbce91c0896', existingId: '73417494-2859-4df3-bc7e-11dcb4834a70' },
  { query: '日笠', id: '93a81a10-3948-4056-b18f-14a96a5319c5', existingId: '1558bd74-c4ea-4fa0-9e08-246939f70f48' }, // 最新=R01 draft
  { query: '平石', id: '48bfee2f-cd84-4e86-9b61-b06de52c8606', existingId: null }, // 既存はApril採番の孤立draftのため参照しない・新規扱い
  { query: '猪上', id: 'b1e7473c-d391-4ede-ba6e-00c0b4231a12', existingId: null },
  { query: '木下', id: 'ffe3ec6e-946d-4bad-a4f8-4f22046ddbb6', existingId: '799a08c7-94cb-445c-9cd6-1457aa168927' },
  { query: '廣瀬', id: '81d9ae34-e1a6-4f7d-8532-724df74d5fa1', existingId: '4444b647-b9f8-46be-a271-a242873b7522' },
];

const ISSUER = {
  toName: '株式会社ACE CREATION',
  toAddr: '〒615-0904<br/>京都市右京区梅津堤上町21 KKハウスⅡ 101',
  toTel: '080-9540-4451',
  toReg: 'T6130001080238',
};

function shortCourseLabel(name) {
  const t = String(name || '').trim();
  if (!t) return '未設定';
  const m = t.match(/\(([^)]+)\)/);
  return m?.[1] ? m[1] : t;
}

// --- org_id (単一テナントACE) ---
const { data: orgRow } = await supabase.from('organizations').select('id').eq('code', 'ACE').single();
const DEFAULT_ORG_ID = orgRow.id;

// --- master data ---
const { data: courseProbe } = await supabase.from('courses').select('id').limit(1);
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
const { data: driverRows } = await supabase.from('drivers').select('id, name, postal_code, address, phone, bank_name, bank_no, bank_holder').in('id', driverIds);
const driverById = new Map(driverRows.map(d => [d.id, d]));

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

// --- 既存請求書の直近リビジョン(メタデータ複製元)を取得 ---
const existingIds = DRIVERS.map(d => d.existingId).filter(Boolean);
const { data: existingInvoices } = await supabase.from('invoice_documents').select('*').in('id', existingIds);
const existingById = new Map(existingInvoices.map(r => [r.id, r]));

// --- 採番: 既存の同一driver向けinvoice_noの最大リビジョンを見て+1 ---
async function nextInvoiceNo(driverId) {
  const prefix = `IN-${MONTH.replace('-', '')}-${driverId.replace(/-/g, '').slice(0, 4).toUpperCase()}-R`;
  const { data } = await supabase.from('invoice_documents').select('invoice_no').like('invoice_no', `${prefix}%`);
  let max = -1;
  for (const row of data ?? []) {
    const m = String(row.invoice_no ?? '').match(new RegExp(`^${prefix}(\\d{2})$`));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${String(max + 1).padStart(2, '0')}`;
}

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
  const drv = driverById.get(d.id);
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

  // 臨時経費のうちマイナス(手当)は請求分(main)へ加算表示
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

  const existing = d.existingId ? existingById.get(d.existingId) : null;
  const existingPayload = existing?.payload ?? {};

  const fromAddr = drv.postal_code ? `〒${drv.postal_code}<br/>${drv.address ?? ''}` : (drv.address ? drv.address : (existingPayload.fromAddr ?? ''));

  const payload = {
    notes: existingPayload.notes ?? '',
    toReg: ISSUER.toReg,
    toTel: ISSUER.toTel,
    bankNo: drv.bank_no ?? existingPayload.bankNo ?? '',
    layout: existingPayload.layout ?? { deductGapMm: 10, headerGapMm: 4, summaryGapMm: 12 },
    period: existingPayload.period ?? '2026年5月1日〜2026年5月31日',
    toAddr: ISSUER.toAddr,
    toName: ISSUER.toName,
    dueDate: existingPayload.dueDate ?? '2026-07-10',
    fromReg: existingPayload.fromReg ?? '-',
    fromTel: drv.phone ?? existingPayload.fromTel ?? '',
    parties: { toParty: 'ace_creation', fromParty: `drv-${d.id}` },
    bankName: drv.bank_name ?? existingPayload.bankName ?? '',
    fromAddr,
    fromName: drv.name,
    honorific: existingPayload.honorific ?? '御中',
    invoiceNo: null, // 後で設定
    loanRepay: 0,
    tableData: { main, deduct },
    bankHolder: drv.bank_holder ?? existingPayload.bankHolder ?? '',
    blockBreaks: existingPayload.blockBreaks ?? [],
    taxSettings: existingPayload.taxSettings ?? { rate: 10, enabled: true },
    displayBasis: 'exclusive',
    extraOutsourcing: 0,
    extraOutsourcingExclusive: 0,
    extraOutsourcingInclusive: 0,
  };

  const invoiceNo = await nextInvoiceNo(d.id);
  payload.invoiceNo = invoiceNo;

  const row = {
    company_code: existing?.company_code ?? 'ACE',
    month_yyyy_mm: MONTH,
    section: existing?.section ?? 'Amazon',
    counterparty_invoice_address_id: null,
    client_name: drv.name,
    issue_date: '2026-07-09',
    invoice_no: invoiceNo,
    amount,
    status: 'draft',
    payload,
    driver_id: d.id,
    is_starred: false,
    org_id: existing?.org_id ?? DEFAULT_ORG_ID,
  };

  results.push({ query: d.query, driverId: d.id, invoiceNo, amount, oldAmount: existing?.amount, row });
}

console.log('=== 生成結果プレビュー ===');
for (const r of results) {
  console.log(`${r.query}: ${r.invoiceNo}  新amount=${r.amount}円  (旧draft amount=${r.oldAmount ?? 'なし'})`);
}

if (!APPLY) {
  console.log('\n--apply が無いため書き込みは行っていません(プレビューのみ)');
} else {
  console.log('\n=== INSERT実行 ===');
  for (const r of results) {
    const { error, data } = await supabase.from('invoice_documents').insert(r.row).select('id, invoice_no').single();
    if (error) console.error(`  ${r.query} ERROR`, error);
    else console.log(`  ${r.query}: 作成 id=${data.id} invoice_no=${data.invoice_no}`);
  }
}
