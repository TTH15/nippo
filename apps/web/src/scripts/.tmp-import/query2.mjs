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

// verify constraint by attempting a harmless test: select role values in use
const { data: roles, error: roleErr } = await supabase.from('drivers').select('role').limit(30);
console.log('--- distinct roles in use ---');
console.log([...new Set((roles||[]).map(r=>r.role))], roleErr);
