/** 明示的な開発DBだけで動かす受け入れ検証。schema154を適用し、使い捨てorgは最後に削除する。 */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import pg from "pg";
import { NextRequest } from "next/server";
const root = process.cwd();
if (process.env.RECORDS_DEV_ACCEPTANCE !== "1")
  throw Error("RECORDS_DEV_ACCEPTANCE=1 is required");
const dev = dotenv.parse(
  fs.readFileSync(path.join(root, "apps/web/.env.development.local")),
);
const prod = dotenv.parse(
  fs.readFileSync(path.join(root, "apps/web/.env.local")),
);
for (const key of [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_DB_URL",
])
  if (!dev[key] || dev[key] === prod[key])
    throw Error("Development isolation check failed");
Object.assign(process.env, dev, { JWT_SECRET: randomUUID() });
const db = new pg.Client({
  connectionString: dev.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
});
await db.connect();
const org = randomUUID(),
  admin = randomUUID(),
  driver = randomUUID(),
  role = randomUUID(),
  formId = randomUUID(),
  recordId = randomUUID();
const code = `RF_${Date.now()}`;
let seeded = false;
let checks = 0;
try {
  await db.query("BEGIN");
  await db.query(
    fs.readFileSync(
      path.join(root, "supabase/migrations/154_org_record_forms.sql"),
      "utf8",
    ),
  );
  await db.query("NOTIFY pgrst, 'reload schema'");
  await db.query("COMMIT");
  console.log("Development schema 154 applied");
  await db.query("BEGIN");
  await db.query(
    "insert into organizations(id,code,name,status) values($1,$2,'Record Forms Acceptance','active')",
    [org, code],
  );
  await db.query(
    "insert into roles(id,org_id,key,label) values($1,$2,'RF_MANAGER','検証管理者')",
    [role, org],
  );
  await db.query(
    "insert into role_capabilities values($1,'can_manage_record_forms')",
    [role],
  );
  await db.query(
    "insert into drivers(id,org_id,company_code,name,role,role_id,driver_code,status,works_as_driver) values($1,$2,'RFT','検証管理者','ADMIN',$3,$4,'active',true),($5,$2,'RFT','検証ドライバー','DRIVER',null,$6,'active',true)",
    [
      admin,
      org,
      role,
      `RFA${Date.now()}`.slice(0, 16),
      driver,
      `RFD${Date.now()}`.slice(0, 16),
    ],
  );
  await db.query("COMMIT");
  seeded = true;
  const { signToken } = await import("../../server/auth/jwt");
  const svc = await import("../../server/recordForms/service");
  const { makeTemplate } = await import("../../lib/recordForms/model");
  const tokens = {
    admin: await signToken({
      driverId: admin,
      role: "ADMIN",
      companyCode: "RFT",
      orgId: org,
    }),
    driver: await signToken({
      driverId: driver,
      role: "DRIVER",
      companyCode: "RFT",
      orgId: org,
    }),
  };
  function req(who: "admin" | "driver", scope: string, body?: unknown) {
    return new NextRequest(`http://localhost/api/record-forms?scope=${scope}`, {
      method: body ? "POST" : "GET",
      headers: { authorization: `Bearer ${tokens[who]}` },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  }
  async function run(status: number, fn: () => Promise<unknown>) {
    const res = await svc.endpoint(fn);
    const data = await res.json();
    assert.equal(res.status, status, JSON.stringify(data));
    checks++;
    return data;
  }
  const template = {
    ...makeTemplate("case", formId),
    access: { [role]: "edit" },
    driver: { submit: true, readOwn: true, editOwn: true, readSubject: true },
  };
  await run(200, () =>
    svc.saveForm(req("admin", "manage", { form: template })),
  );
  const bootstrap = await run(200, () => svc.bootstrap(req("driver", "self")));
  assert.equal(bootstrap.members.length, 1);
  assert.deepEqual(bootstrap.forms[0].access, {});
  const answers = {
    title: "受け入れ検証",
    date: "2026-08-31",
    subject: driver,
    category: "misdelivery",
    body: "検証用の架空データ",
  };
  await run(200, () =>
    svc.saveRecord(
      req("driver", "self", { id: recordId, formVersion: 1, answers }),
      formId,
    ),
  );
  await run(409, () =>
    svc.saveRecord(
      req("driver", "self", { id: recordId, formVersion: 1, answers }),
      formId,
    ),
  );
  await run(200, () =>
    svc.saveRecord(
      req("admin", "staff", {
        expectedVersion: 1,
        formVersion: 1,
        internal: true,
        note: "本人には非公開",
      }),
      formId,
      recordId,
    ),
  );
  const self = await run(200, () =>
    svc.getRecord(req("driver", "self"), formId, recordId),
  );
  assert.equal(
    self.record.history.some((h: { internal: boolean }) => h.internal),
    false,
  );
  assert.equal(self.record.version, 2);
  const staff = await run(200, () =>
    svc.getRecord(req("admin", "staff"), formId, recordId),
  );
  assert.equal(staff.record.history.length, 2);
  await run(403, () =>
    svc.saveRecord(
      req("driver", "self", {
        expectedVersion: 2,
        formVersion: 1,
        internal: true,
        note: "不正",
      }),
      formId,
      recordId,
    ),
  );
  await run(200, () =>
    svc.saveForm(
      req("admin", "manage", {
        expectedVersion: 1,
        form: { ...template, version: 2, statuses: [] },
      }),
      formId,
    ),
  );
  await run(409, () =>
    svc.saveRecord(
      req("driver", "self", {
        expectedVersion: 2,
        formVersion: 1,
        answers,
        note: "古い設定",
      }),
      formId,
      recordId,
    ),
  );
  await run(200, () =>
    svc.saveRecord(
      req("admin", "staff", {
        expectedVersion: 2,
        formVersion: 2,
        answers,
        reporter: driver,
        status: "resolved",
        note: "完了",
      }),
      formId,
      recordId,
    ),
  );
  const detail = await run(200, () =>
    svc.getRecord(req("driver", "self"), formId, recordId),
  );
  assert.equal(detail.record.schema.version, 1);
  assert.equal(detail.record.status, "resolved");
  await run(200, () =>
    svc.saveForm(
      req("admin", "manage", {
        expectedVersion: 2,
        form: {
          ...template,
          version: 3,
          driver: {
            submit: false,
            readOwn: false,
            editOwn: false,
            readSubject: false,
          },
        },
      }),
      formId,
    ),
  );
  await run(404, () => svc.getRecord(req("driver", "self"), formId, recordId));
  const listing = await run(200, () =>
    svc.listRecords(req("admin", "staff"), formId),
  );
  assert.equal(listing.records.length, 1);
  console.log(`${checks} real API/database checks passed`);
} finally {
  await db.query("ROLLBACK");
  if (seeded) {
    await db.query("BEGIN");
    for (const table of [
      "org_record_events",
      "org_records",
      "org_record_form_versions",
      "org_record_forms",
    ])
      await db.query(`delete from ${table} where org_id=$1`, [org]);
    await db.query("delete from drivers where org_id=$1", [org]);
    await db.query(
      "delete from role_capabilities where role_id in (select id from roles where org_id=$1)",
      [org],
    );
    await db.query("delete from roles where org_id=$1", [org]);
    await db.query("delete from organizations where id=$1 and code=$2", [
      org,
      code,
    ]);
    await db.query("COMMIT");
    console.log("Acceptance fixture removed");
  }
  await db.end();
}
