import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const env = Object.fromEntries(
  fs.readFileSync(process.env.ENV_FILE, 'utf8')
    .split('\n')
    .filter(l => l.includes('='))
    .map(l => {
      const i = l.indexOf('=');
      let v = l.slice(i + 1).trim();
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
      return [l.slice(0, i), v];
    })
);

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const { data: orgs, error: orgErr } = await supabase.from('organizations').select('id, code, name, status');
console.log('--- organizations ---');
console.log(JSON.stringify(orgs, null, 2), orgErr);

const { data: addrs, error: addrErr } = await supabase
  .from('invoice_addresses')
  .select('id, company_code, org_id, name, postal_code, address, phone, invoice_no')
  .or('name.ilike.%万事屋%,name.ilike.%うっちゃん%,name.ilike.%フイアンツ%,name.ilike.%fiants%');
console.log('--- invoice_addresses (万事屋/フイアンツ) ---');
console.log(JSON.stringify(addrs, null, 2), addrErr);

const { count } = await supabase.from('drivers').select('*', { count: 'exact', head: true });
console.log('--- drivers count ---', count);

const { data: drivers, error: drvErr } = await supabase
  .from('drivers')
  .select('id, name, display_name, bank_holder, org_id, status')
  .limit(500);
console.log('--- drivers sample (first 30) ---');
console.log(JSON.stringify(drivers?.slice(0, 30), null, 2), drvErr);
console.log('total drivers fetched:', drivers?.length);
