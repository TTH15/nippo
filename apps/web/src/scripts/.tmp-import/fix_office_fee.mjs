import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
const env = Object.fromEntries(fs.readFileSync(process.env.ENV_FILE,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');let v=l.slice(i+1).trim();if(v.startsWith('"')&&v.endsWith('"'))v=v.slice(1,-1);return [l.slice(0,i),v];}));
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const APPLY = process.argv.includes('--apply');

const TARGETS = [
  { name: '日笠', invoiceId: '92deff96-ae4c-4d89-b470-a97cb4b36af1', fixedExpId: '5bcaee7e-f68f-4ee4-8a26-b8b618507572', newPrice: 4000 },
  { name: '平石', invoiceId: '03a07f7d-2770-4096-a8ec-5eb22d09ef9f', fixedExpId: '75317221-9fc4-4877-9a8e-e8e40631465b', newPrice: 3000 },
  { name: '木下', invoiceId: 'f2d44515-cd83-4236-bd11-2da6b92cf503', fixedExpId: '89056fe9-0dd2-426b-b6ea-50989172ec49', newPrice: 4000 },
  { name: '梶原', invoiceId: 'f1b38298-8427-41a1-b499-67b1aa39a62c', fixedExpId: 'eec1a98a-ccdd-44ec-bea8-a5b75eb211ed', newPrice: 4000 },
  { name: '坂田', invoiceId: 'a18c96a5-038d-405e-94ac-687f213faef5', fixedExpId: 'b702670c-9077-49ee-956e-60bfc078c9a3', newPrice: 4000 },
  { name: '勝政', invoiceId: 'de956a43-5c21-415f-8b9e-99b63c695ed3', fixedExpId: '2be91e65-f00f-46ba-8751-a438b705f919', newPrice: 4000 },
  { name: '猪上', invoiceId: 'afd3c43b-f540-4342-9474-b088652db882', fixedExpId: 'e4e91e93-8b5c-4240-8493-872d8f9dd228', newPrice: 4000 },
  { name: '廣瀬', invoiceId: '56640412-bb80-48d7-b139-761f2adaf168', fixedExpId: 'c0ee2216-f126-464e-a012-db8ffe2d5729', newPrice: 4000 },
  { name: '島本', invoiceId: '86ad82f8-d810-49fa-a394-942d28646aa9', fixedExpId: '402479a3-791a-4ad9-87ac-7134adea3a4a', newPrice: 4000 },
];

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

const ids = TARGETS.map(t => t.invoiceId);
const { data: rows } = await supabase.from('invoice_documents').select('id, invoice_no, amount, payload').in('id', ids);
const rowById = new Map(rows.map(r => [r.id, r]));

const results = [];
for (const t of TARGETS) {
  const row = rowById.get(t.invoiceId);
  const payload = row.payload;
  const deduct = payload.tableData.deduct;
  const idx = deduct.findIndex(l => l.title === '事務手数料');
  if (idx === -1) {
    console.log(`  ! ${t.name}: 「事務手数料」行が見つかりません`);
    continue;
  }
  const oldPrice = deduct[idx].price;
  const newDeduct = deduct.map((l, i) => i === idx ? { ...l, price: t.newPrice } : l);
  const newAmount = computeAmount(payload.tableData.main, newDeduct);
  const newPayload = { ...payload, tableData: { ...payload.tableData, deduct: newDeduct } };
  results.push({ name: t.name, invoiceId: t.invoiceId, invoiceNo: row.invoice_no, fixedExpId: t.fixedExpId, newPriceForExp: t.newPrice, oldPrice, oldAmount: row.amount, newAmount, newPayload });
}

console.log('=== プレビュー ===');
for (const r of results) {
  console.log(`${r.name} ${r.invoiceNo}: 事務手数料 ${r.oldPrice} -> ${r.newPriceForExp}円  amount ${r.oldAmount} -> ${r.newAmount}円`);
}

if (!APPLY) {
  console.log('\n--apply が無いため書き込みは行っていません(プレビューのみ)');
} else {
  console.log('\n=== 実行 ===');
  for (const r of results) {
    const { error: e1 } = await supabase.from('driver_fixed_expenses').update({ amount: r.newPriceForExp, updated_at: new Date().toISOString() }).eq('id', r.fixedExpId);
    const { error: e2 } = await supabase.from('invoice_documents').update({ amount: r.newAmount, payload: r.newPayload }).eq('id', r.invoiceId);
    console.log(`  ${r.name}: fixedExp=${e1 ? 'ERR:'+e1.message : 'OK'} invoice=${e2 ? 'ERR:'+e2.message : 'OK'}`);
  }
}
