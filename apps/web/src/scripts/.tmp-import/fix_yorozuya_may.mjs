import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
const env = Object.fromEntries(fs.readFileSync(process.env.ENV_FILE,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');let v=l.slice(i+1).trim();if(v.startsWith('"')&&v.endsWith('"'))v=v.slice(1,-1);return [l.slice(0,i),v];}));
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const APPLY = process.argv.includes('--apply');
const ID = '89e78ffc-9081-48e9-9b48-6e9702362655';

const { data: row } = await supabase.from('invoice_documents').select('*').eq('id', ID).single();
const payload = row.payload;
const main = payload.tableData.main.map(l => ({ ...l }));
const deduct = [];

// --- main: 数量修正(4件のみ。他はPDFと一致済み) ---
const setQty = (title, newQty) => {
  const line = main.find(l => l.title === title);
  if (!line) throw new Error(`main行が見つかりません: ${title}`);
  const old = line.qty;
  line.qty = newQty;
  console.log(`  main「${title}」 qty ${old} -> ${newQty}`);
};
setQty('Amazon昼（日笠）', 5);           // 吉祥院Amazon: 4日 -> 5日
setQty('豊中Amazon昼（日笠）', 1);        // 豊中Amazon: 2日 -> 1日
setQty('ヤマト上京 宅急便（勝政）', 1310); // 1284 -> 1310
setQty('ヤマト上京 ネコポス（勝政）', 775);// 798 -> 775
setQty('ヤマト壬生 宅急便（勝政）', 73);   // 99 -> 73
setQty('ヤマト壬生 ネコポス（勝政）', 48); // 25 -> 48

// --- deduct: PDF 経費ご請求分(32-37)に合わせて6行に作り直す ---
deduct.push({ qty: 1, unit: '回', price: 1600, title: '1日リース料金（梶原、5/18）', priceBasis: 'inclusive' });
deduct.push({ qty: 1, unit: '件', price: 70, title: 'オイル交換費 まとめ（梶原）', priceBasis: 'inclusive' });
deduct.push({ qty: 2, unit: '回', price: 800, title: '車両リース半日（平石、5/18.19）', priceBasis: 'inclusive' });
deduct.push({ qty: 1, unit: '件', price: 140, title: 'オイル交換費 まとめ（平石）', priceBasis: 'inclusive' });
deduct.push({ qty: 1, unit: '件', price: 100000, title: '求人広告費用（マイナビスーパー、5月から6月）', priceBasis: 'inclusive' });
deduct.push({ qty: 1, unit: '件', price: 660, title: '振込手数料', priceBasis: 'inclusive' });

function computeInclusiveTotals(mainRows, deductRows, rate) {
  const rowsTotal = (rows) => {
    const sum = rows.reduce((acc, r) => acc + Math.round(r.qty * r.price), 0);
    const subtotal = Math.floor(sum / (1 + rate));
    return { subtotal, tax: sum - subtotal, gross: sum };
  };
  const bill = rowsTotal(mainRows);
  const ded = rowsTotal(deductRows);
  return { billSubtotal: bill.subtotal, billTax: bill.tax, billGross: bill.gross, deductSubtotal: ded.subtotal, deductTax: ded.tax, deductGross: ded.gross, total: bill.gross - ded.gross };
}

const totals = computeInclusiveTotals(main, deduct, 0.10);
console.log('\n=== 検算 ===');
console.log('main合計(小計相当):', totals.billGross, '(PDF小計=2,308,765)');
console.log('deduct合計(経費計相当):', totals.deductGross, '(PDF経費計=104,070)');
console.log('差引き合計:', totals.total, '(PDF合計=2,204,695)');

const newPayload = { ...payload, tableData: { main, deduct } };

console.log(`\n旧amount=${row.amount} 新amount=${totals.total}`);

if (!APPLY) {
  console.log('\n--apply が無いため書き込みは行っていません(プレビューのみ)');
} else {
  const { error } = await supabase.from('invoice_documents').update({ amount: totals.total, payload: newPayload }).eq('id', ID);
  console.log(error ? `ERROR: ${error.message}` : 'UPDATE OK');
}
