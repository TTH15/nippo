// docker run --rm -d --name hakotora-security-test -e POSTGRES_PASSWORD=local-test-only public.ecr.aws/supabase/postgres:17.6.1.165
// docker exec hakotora-security-test createdb -U postgres hakotora_security_test
// node scripts/db/tests/security-local.mjs
// docker rm -f hakotora-security-test
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function sql(input, onOutput = () => {}) {
  const child = spawn('docker',['exec','-i','hakotora-security-test','psql','-U','postgres','-d','hakotora_security_test','-At','-v','ON_ERROR_STOP=1']);
  let out='',err=''; child.stdout.on('data', x => { out+=x; onOutput(out); }); child.stderr.on('data',x => err+=x); child.stdin.end(input);
  return new Promise((resolve,reject) => { child.on('error',reject); child.on('close',code => resolve({code,out,err})); });
}
async function okay(input) { const r=await sql(input); assert.equal(r.code,0,r.err); return r; }
const migration = await readFile('supabase/migrations/166_passkey_management_notice.sql','utf8');
const retire = await readFile('supabase/migrations/167_retire_driver_pin.sql','utf8');
await okay(await readFile('scripts/db/tests/security-local-setup.sql','utf8'));
await okay(`BEGIN; ${migration} COMMIT;`);
const setup = `INSERT INTO organizations VALUES('${id(1)}','TEST','架空会社','active');
INSERT INTO identities(id,name,pin_hash) VALUES('${id(2)}','架空本人','driver-hash'),('${id(3)}','架空運営','admin-hash');
INSERT INTO drivers VALUES('${id(4)}','架空本人','DRIVER','${id(1)}','${id(2)}','active','driver-hash'),('${id(5)}','架空運営','ADMIN','${id(1)}','${id(3)}','active','admin-hash');`;
await okay(setup);
const blocked=await sql(`BEGIN; ${retire} COMMIT;`);
assert.notEqual(blocked.code,0); assert.match(blocked.err,/PIN retirement blocked/);
assert.equal((await okay(`SELECT pin_hash FROM drivers WHERE id='${id(4)}'`)).out.trim(),'driver-hash');
await okay(`BEGIN; UPDATE identities SET phone='+819000000001',phone_verified_at=now() WHERE id='${id(2)}'; ${retire}
DO $$ BEGIN IF (SELECT pin_hash FROM drivers WHERE id='${id(4)}') IS NOT NULL OR (SELECT pin_hash FROM identities WHERE id='${id(2)}') IS NOT NULL THEN RAISE EXCEPTION 'driver PIN retained'; END IF;
IF (SELECT pin_hash FROM drivers WHERE id='${id(5)}')<>'admin-hash' OR (SELECT pin_hash FROM identities WHERE id='${id(3)}')<>'admin-hash' THEN RAISE EXCEPTION 'admin password changed'; END IF; END $$; ROLLBACK;`);
await okay(`ALTER TABLE notifications ADD CONSTRAINT fail_notice CHECK(kind<>'account_security');`);
const register = suffix => `SELECT manage_passkey('${id(4)}','${id(2)}','${id(1)}','register',jsonb_build_object('credential_id','key-${suffix}','public_key','\\x01','counter',0,'device_type','multiDevice','backed_up',true))->>'keyId';`;
const failed = await sql(register('notice-fail')); assert.notEqual(failed.code,0);
assert.equal((await okay('SELECT count(*) FROM passkey_credentials;')).out.trim(),'0');
await okay('ALTER TABLE notifications DROP CONSTRAINT fail_notice;');
const firstKey=(await okay(register('a'))).out.trim(); const secondKey=(await okay(register('b'))).out.trim();
const remove = key => `SELECT manage_passkey('${id(4)}','${id(2)}','${id(1)}','delete',NULL,'${key}');`;
let signal; const locked = new Promise(resolve => signal=resolve);
const first=sql(`BEGIN; SELECT id FROM identities WHERE id='${id(2)}' FOR UPDATE;\n\\echo LOCKED\nSELECT pg_sleep(1); ${remove(firstKey)} COMMIT;`,out => {if(out.includes('LOCKED'))signal();});
await Promise.race([locked,first.then(r=>{if(r.code!==0)throw Error(r.err);})]);
const second=sql(remove(secondKey)); const [a,b]=await Promise.all([first,second]);
assert.equal(a.code,0,a.err); assert.notEqual(b.code,0); assert.match(b.err,/recovery required/);
assert.equal((await okay('SELECT count(*) FROM passkey_credentials; SELECT count(*) FROM notifications;')).out.trim(),'1\n3');
console.log('PASS: PIN cutoff guard, admin password preserved, notification failure rolls back key, concurrent deletion retains one key and exactly one delete notice.');
