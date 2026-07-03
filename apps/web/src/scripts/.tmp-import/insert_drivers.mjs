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
const ACE_ORG_ID = '1314c7a1-0f86-44fd-8f60-01588735295a';

const rows = [
  { name: '木戸偲愛', display_name: '木戸', role: 'DRIVER', status: 'inactive', org_id: ACE_ORG_ID, company_code: 'ACE' },
  { name: '永戸大心', display_name: '永戸', role: 'DRIVER', status: 'inactive', org_id: ACE_ORG_ID, company_code: 'ACE' },
];

const { data, error } = await supabase.from('drivers').insert(rows).select('id, name, display_name, status, org_id');
console.log(JSON.stringify(data, null, 2), error);
