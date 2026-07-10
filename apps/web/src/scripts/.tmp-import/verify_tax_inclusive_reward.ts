import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.production.local') });
import { computeDriverAutoPayout } from '../../server/billing/driverPayout';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function main() {
  const orgId = '1314c7a1-0f86-44fd-8f60-01588735295a'; // ACE
  const driverId = 'b8ebbb05-6dff-4a35-b5ba-2a4f017e87b5'; // 梶原優旗
  const startDate = '2026-05-01';
  const endDate = '2026-05-31';

  const exclusive = await computeDriverAutoPayout(supabase, orgId, driverId, startDate, endDate);
  const inclusive = await computeDriverAutoPayout(supabase, orgId, driverId, startDate, endDate, { taxInclusive: true });

  console.log('=== 税抜(会計用・従来通り) ===');
  exclusive.lines.forEach((l) => console.log(`  ${l.title}: qty=${l.qty} unitPrice=${l.unitPrice} amount=${l.amount}`));
  console.log('total:', exclusive.total);

  console.log('\n=== 税込(ドライバー表示用・新規) ===');
  inclusive.lines.forEach((l) => console.log(`  ${l.title}: qty=${l.qty} unitPrice=${l.unitPrice} amount=${l.amount}`));
  console.log('total:', inclusive.total);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
