// Isolated, disposable PostgreSQL only. No project env or external connection is read.
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync,spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{Pool}=require('pg');
const root=resolve(import.meta.dirname,'../..');
const fixture=mkdtempSync(join(tmpdir(),'hakotora-memo-fixture-'));
let container,tunnel;
const migration=readFileSync(join(root,'supabase/migrations/20261011125113_shared_shift_memo_hidden_people.sql'),'utf8')+'\n'+readFileSync(join(root,'supabase/migrations/20261031100243_shift_memo_background_colors.sql'),'utf8');
let running=false,pool,passed=0;
const org='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',actor='aaaaaaaa-1111-4111-8111-111111111111',other='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const initial={version:1,lanes:[],laneOrder:[],assignments:{origin:[{placementId:'one',name:'甲'}],target:[{placementId:'remote',name:'乙'}]},notes:{},dayOverrides:{},requiredCountOverrides:{},extraPeople:[]};
const change=(field,key,expected,value)=>({field,key,expected,value});
async function test(name,fn){await fn();console.log(`PASS ${name}`);passed++;}
async function context(c,cap=true,orgId=org){await c.query("select set_config('fixture.org',$1,false),set_config('fixture.actor',$2,false),set_config('fixture.manage',$3,false)",[orgId,actor,String(cap)]);}
async function save(c,changes,legacy=false){return (await c.query(`select public.${legacy?'save_shared_shift_memo_board':'save_shared_shift_memo_board_runtime'}($1,$2,$3::jsonb,$4::jsonb) result`,[org,actor,JSON.stringify(initial),JSON.stringify(changes)])).rows[0].result;}
const metadata=async()=>({functions:(await pool.query("select proname,proowner::regrole::text owner,prosecdef,proconfig,proacl::text from pg_proc where proname in ('save_shared_shift_memo_board','save_shared_shift_memo_board_runtime') order by proname")).rows,policies:(await pool.query("select * from pg_policies where tablename='shared_shift_memo_boards' order by policyname")).rows,table:(await pool.query("select relowner::regrole::text owner,relacl::text,relrowsecurity,relforcerowsecurity from pg_class where oid='public.shared_shift_memo_boards'::regclass")).rows});
const canonical=async()=> (await pool.query('select board,revision from shared_shift_memo_boards where org_id=$1',[org])).rows[0];
try{
 container=execFileSync('docker',['run','-d','--rm','--network','none','--pull','never','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17'],{encoding:'utf8'}).trim();
 assert.match(container,/^[0-9a-f]{64}$/);running=true;
 let ready=false;for(let i=0;i<100;i++){try{execFileSync('docker',['exec',container,'pg_isready','-h','127.0.0.1','-U','postgres'],{stdio:'ignore'});ready=true;break;}catch{await new Promise(r=>setTimeout(r,100));}}assert.ok(ready,'disposable postgres must become ready');
 tunnel=createServer(socket=>{const child=spawn('docker',['exec','-i',container,'bash','-c','exec 3<>/dev/tcp/127.0.0.1/5432; cat <&3 & cat >&3; wait'],{stdio:['pipe','pipe','ignore']});socket.pipe(child.stdin);child.stdout.pipe(socket);socket.on('close',()=>child.kill());child.on('exit',()=>socket.destroy());child.stdin.on('error',()=>socket.destroy());});
 await new Promise(r=>tunnel.listen(0,'127.0.0.1',r));
 pool=new Pool({host:'127.0.0.1',port:tunnel.address().port,database:'postgres',user:'postgres',max:4});
 await pool.query("create role anon;create role authenticated;create role service_role bypassrls;create role hakotora_runtime;create role hakotora_board_writer;create table organizations(id uuid primary key);create table drivers(id uuid primary key);insert into organizations values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');insert into drivers values('aaaaaaaa-1111-4111-8111-111111111111');");
 await pool.query(readFileSync(join(root,'supabase/migrations/184_shared_shift_memo_board.sql'),'utf8'));
 const beforeLegacy=await metadata();await pool.query(migration);
 await test('legacy-only install preserves owners, ACL, SECURITY, RLS and policies',async()=>assert.deepEqual(await metadata(),beforeLegacy));
 const legacy=await pool.connect();
 try{await legacy.query('set role service_role');
 await test('legacy board missing hiddenPeople supports hide and restore',async()=>{
  let r=await save(legacy,[change('hiddenPeople','custom:甲',null,true)],true);assert.equal(r.saved,true);assert.deepEqual(r.board.hiddenPeople,{'custom:甲':true});
  r=await save(legacy,[change('hiddenPeople','custom:甲',true,null)],true);assert.equal(r.saved,true);assert.deepEqual(r.board.hiddenPeople,{});assert.deepEqual(r.board.assignments,initial.assignments);
 });}finally{await legacy.query('reset role');legacy.release();}
 await pool.query("create schema hakotora_security;create function hakotora_security.actor() returns jsonb language sql stable as $$select jsonb_build_object('orgId',current_setting('fixture.org',true),'driverId',current_setting('fixture.actor',true))$$;create function hakotora_security.has_capability(text) returns boolean language sql stable as $$select coalesce(current_setting('fixture.manage',true),'false')='true'$$;grant usage on schema hakotora_security to hakotora_runtime,hakotora_board_writer;grant execute on all functions in schema hakotora_security to hakotora_runtime,hakotora_board_writer;");
 await pool.query(readFileSync(join(root,'scripts/tests/fixtures/shared-memo-runtime.sql'),'utf8'));
 await pool.query('revoke all on function public.save_shared_shift_memo_board_runtime(uuid,uuid,jsonb,jsonb) from public');
 const before=await metadata();await pool.query(migration);await pool.query(migration);
 await test('runtime install and rerun preserve owners, ACL, SECURITY, RLS and policies',async()=>assert.deepEqual(await metadata(),before));
 const c=await pool.connect();try{await c.query('set role hakotora_runtime');await context(c);
 await test('runtime hide/restore persists across separate GET connections',async()=>{
  assert.equal((await save(c,[change('hiddenPeople','driver:甲',null,true)])).saved,true);assert.equal((await canonical()).board.hiddenPeople['driver:甲'],true);
  assert.equal((await save(c,[change('hiddenPeople','driver:甲',true,null)])).saved,true);assert.equal((await canonical()).board.hiddenPeople['driver:甲'],undefined);
 });
 await test('hidden candidate validation rejects nonboolean and unrelated key',async()=>{
  for(const value of [false,'true',[],{}]) await assert.rejects(save(c,[change('hiddenPeople','driver:甲',null,value)]),e=>e.code==='22023');
  await assert.rejects(save(c,[change('hiddenPeople','invalid',null,true)]),e=>e.code==='22023');
 });
 await test('old boards retain weekday and date colors, clear only the chosen key',async()=>{
  let r=await save(c,[change('backgroundColors','weekday:1',null,'yellow')]);assert.equal(r.saved,true);
  r=await save(c,[change('backgroundColors','date:2026-10-19',null,'none')]);assert.equal(r.saved,true);
  r=await save(c,[change('backgroundColors','date:2026-10-19','none',null)]);assert.deepEqual(r.board.backgroundColors,{'weekday:1':'yellow'});
  assert.deepEqual(r.board.assignments,initial.assignments);
 });
 await test('row, course and cell colors preserve every unrelated map entry',async()=>{
  let r=await save(c,[change('backgroundColors','row:lane-a',null,'sky'),change('backgroundColors','course:course-a',null,'green'),change('backgroundColors','cell:lane-a|2026-10-25',null,'rose')]);
  assert.equal(r.saved,true);assert.equal(r.board.backgroundColors['row:lane-a'],'sky');assert.equal(r.board.backgroundColors['cell:lane-a|2026-10-25'],'rose');assert.equal(r.board.backgroundColors['weekday:1'],'yellow');assert.deepEqual(r.board.assignments,initial.assignments);
 });
 await test('color validation rejects unrelated keys, CSS strings, booleans and invalid weekdays',async()=>{
  for(const [key,value] of [['weekday:9','yellow'],['other','rose'],['weekday:1','#fff'],['date:2026-10-19',true]])
   await assert.rejects(save(c,[change('backgroundColors',key,null,value)]),e=>e.code==='22023');
 });
 await test('same color key conflicts without overwriting the stored selection',async()=>{
  const before=await canonical();const r=await save(c,[change('backgroundColors','weekday:1',null,'sky')]);assert.equal(r.saved,false);assert.deepEqual(await canonical(),before);
 });
 await test('runtime capability and organization guards remain enforced',async()=>{
  await context(c,false);await assert.rejects(save(c,[change('hiddenPeople','custom:甲',null,true)]),e=>e.code==='42501');
  await context(c,true,other);await assert.rejects(save(c,[change('hiddenPeople','custom:甲',null,true)]),e=>e.code==='42501');await context(c);
  assert.equal((await c.query('select count(*)::int n from shared_shift_memo_boards where org_id=$1',[other])).rows[0].n,0);
 });
 await test('conflicting personnel move persists neither half, RPC partial board is not canonical',async()=>{
  const before=await canonical();const r=await save(c,[change('assignments','origin',initial.assignments.origin,[]),change('assignments','target',[],initial.assignments.origin)]);
  assert.equal(r.saved,false);assert.deepEqual(r.board.assignments.origin,[]);assert.deepEqual(await canonical(),before);
 });
 }finally{await c.query('reset role');c.release();}
 await test('row lock serializes different people without losing either hide',async()=>{
  const a=await pool.connect(),b=await pool.connect();try{
   await a.query('set role hakotora_runtime');await b.query('set role hakotora_runtime');await context(a);await context(b);
   await a.query('begin');await b.query('begin');await save(a,[change('hiddenPeople','custom:A',null,true)]);
   const pid=(await b.query('select pg_backend_pid() pid')).rows[0].pid;
   const waiting=save(b,[change('hiddenPeople','custom:B',null,true)]);
   let locked=false;for(let i=0;i<30;i++){if((await pool.query('select wait_event_type from pg_stat_activity where pid=$1',[pid])).rows[0]?.wait_event_type==='Lock'){locked=true;break;}await new Promise(r=>setTimeout(r,10));}
   assert.ok(locked);await a.query('commit');assert.equal((await waiting).saved,true);await b.query('commit');
   const current=await canonical();assert.equal(current.board.hiddenPeople['custom:A'],true);assert.equal(current.board.hiddenPeople['custom:B'],true);assert.deepEqual(current.board.assignments,initial.assignments);
  }finally{await a.query('rollback');await b.query('rollback');await a.query('reset role');await b.query('reset role');a.release();b.release();}
 });
 console.log(`Shared shift memo disposable DB: ${passed} checks passed`);
}finally{
 if(pool)await pool.end();
 if(tunnel)await new Promise(r=>tunnel.close(r));
 if(running)execFileSync('docker',['rm','-f',container],{stdio:'ignore'});
 rmSync(fixture,{recursive:true,force:true});
}
