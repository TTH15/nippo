// setup + migration 165 を入れた専用コンテナで、同じ確認結果の同時確定を検証する。
import { spawn } from "node:child_process";
import assert from "node:assert/strict";

const args = ["exec", "-i", "hakotora-memo-reflect-test", "psql", "-U", "postgres", "-d", "hakotora_memo_test", "-At", "-v", "ON_ERROR_STOP=1"];
function sql(text, onOutput = () => {}) {
  const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
  let out = "", err = "";
  child.stdout.on("data", data => { out += data; onOutput(out); });
  child.stderr.on("data", data => { err += data; });
  child.stdin.end(text);
  return new Promise((resolve, reject) => { child.on("error", reject); child.on("close", code => resolve({ code, out, err })); });
}
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const setup = await sql(`
DO $$ BEGIN IF current_database()<>'hakotora_memo_test' THEN RAISE EXCEPTION 'Wrong database'; END IF; END $$;
INSERT INTO organizations VALUES('${id(1)}');
INSERT INTO drivers(id,org_id,name) VALUES('${id(10)}','${id(1)}','架空管理者'),('${id(11)}','${id(1)}','架空ドライバー');
INSERT INTO courses(id,org_id,name) VALUES('${id(100)}','${id(1)}','架空コース');
`);
assert.equal(setup.code, 0, setup.err);
const groups = JSON.stringify([{ date: "2026-09-16", courseId: id(100), cycleNo: 0, driverIds: [id(11)] }]);
const call = `public.reflect_shift_memo('${id(1)}','${id(10)}','${groups}'::jsonb,'add'`;
const preview = await sql(`SELECT ${call})->>'revision';`);
assert.equal(preview.code, 0, preview.err);
const revision = preview.out.trim();
assert.match(revision, /^[a-f0-9]{32}$/);
let signal;
const locked = new Promise(resolve => { signal = resolve; });
const first = sql(`BEGIN; LOCK TABLE public.shifts IN SHARE ROW EXCLUSIVE MODE;\n\\echo LOCKED\nSELECT pg_sleep(1); SELECT ${call},'${revision}')->>'added'; COMMIT;`, out => { if (out.includes("LOCKED")) signal(); });
await Promise.race([locked, first.then(result => { if (result.code !== 0) throw new Error(result.err); })]);
const second = sql(`SELECT ${call},'${revision}');`);
const [one, two] = await Promise.all([first, second]);
assert.equal(one.code, 0, one.err);
assert.notEqual(two.code, 0, "Both writes must not succeed");
assert.match(two.err, /Shifts changed since preview/);
const result = await sql("SELECT count(*) FROM shifts WHERE driver_id IS NOT NULL; SELECT count(*) FROM shift_change_logs;");
assert.equal(result.out.trim(), "1\n1");
const cleanup = await sql("TRUNCATE shift_change_logs,shift_requests,shifts,course_cycles,courses,drivers,organizations CASCADE;");
assert.equal(cleanup.code, 0, cleanup.err);
console.log("Concurrent apply: one success, one conflict, exactly one assignment and one log.");
