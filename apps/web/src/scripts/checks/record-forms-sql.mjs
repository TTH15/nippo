// 外部DB・環境変数を読まない、ローカルPostgreSQLでのRPC検証。
// PGliteを一時ディレクトリにインストールし RECORDS_PGLITE_MODULE に dist/index.js を指定して実行可能。
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const { PGlite } = await import(
  process.env.RECORDS_PGLITE_MODULE || "@electric-sql/pglite"
);
const db = new PGlite();
let checks = 0;
const query = (sql, args = []) => db.query(sql, args);
const rejects = async (fn, pattern) => {
  await assert.rejects(fn, pattern);
  checks++;
};
const org = "11111111-1111-4111-8111-111111111111",
  foreign = "11111111-1111-4111-8111-111111111112";
const admin = "22222222-2222-4222-8222-222222222221",
  driver = "22222222-2222-4222-8222-222222222222",
  outsider = "22222222-2222-4222-8222-222222222223";
const managerRole = "33333333-3333-4333-8333-333333333331",
  driverRole = "33333333-3333-4333-8333-333333333332",
  foreignRole = "33333333-3333-4333-8333-333333333333";
const formId = "44444444-4444-4444-8444-444444444444",
  recordId = "55555555-5555-4555-8555-555555555555",
  newRecordId = "55555555-5555-4555-8555-555555555556";
const statuses = [
  { id: "open", label: "未対応", terminal: false },
  { id: "progress", label: "対応中", terminal: false },
  { id: "resolved", label: "解決済み", terminal: true },
];
let form = {
  id: formId,
  version: 1,
  name: "記録",
  category: "試験",
  fields: [
    { id: "title", type: "short_text", label: "件名", required: true },
    { id: "subject", type: "member", label: "対象者", required: false },
    { id: "date", type: "date", label: "日付", required: false },
  ],
  titleField: "title",
  subjectField: "subject",
  dateField: "date",
  access: { [managerRole]: "edit", [driverRole]: "none" },
  statuses,
  driver: { submit: false, readOwn: false, editOwn: false, readSubject: false },
};
const saveForm = (actor, expected, definition = form) =>
  query("select save_org_record_form($1,$2,$3,$4,$5)", [
    org,
    actor,
    formId,
    expected,
    definition,
  ]);
const payload = {
  answers: { title: "本文", subject: driver, date: "2026-08-31" },
  reporter: driver,
  status: "open",
  memberNames: { [admin]: "管理者", [driver]: "本人" },
  searchText: "本文",
  note: "作成",
  internal: false,
};
const save = (
  actor,
  expected,
  version = 1,
  scope = "staff",
  body = payload,
  id = recordId,
) =>
  query("select save_org_record($1,$2,$3,$4,$5,$6,$7,$8)", [
    org,
    actor,
    formId,
    id,
    version,
    expected,
    scope,
    body,
  ]);
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE TABLE organizations(id uuid PRIMARY KEY,status text NOT NULL);
 CREATE TABLE roles(id uuid PRIMARY KEY,org_id uuid NOT NULL REFERENCES organizations(id),label text);
 CREATE TABLE role_capabilities(role_id uuid REFERENCES roles(id),capability text,PRIMARY KEY(role_id,capability));
 CREATE TABLE drivers(id uuid PRIMARY KEY,org_id uuid REFERENCES organizations(id),role_id uuid REFERENCES roles(id),role text,status text,name text,works_as_driver boolean);
 GRANT SELECT ON organizations,roles,role_capabilities,drivers TO service_role; GRANT UPDATE ON drivers TO service_role; GRANT INSERT ON role_capabilities TO service_role;`);
  const sql = await readFile(
    new URL(
      "../../../../../supabase/migrations/154_org_record_forms.sql",
      import.meta.url,
    ),
    "utf8",
  );
  await db.exec(sql);
  await db.exec(sql);
  checks++;
  await query("insert into organizations values ($1,'active'),($2,'active')", [
    org,
    foreign,
  ]);
  await query(
    "insert into roles values ($1,$2,'管理者'),($3,$2,'ドライバー'),($4,$5,'他社')",
    [managerRole, org, driverRole, foreignRole, foreign],
  );
  await query(
    "insert into role_capabilities values ($1,'can_manage_org_settings')",
    [managerRole],
  );
  await query(
    "insert into drivers values ($1,$2,$3,'ADMIN','active','管理者',true),($4,$2,$5,'DRIVER','active','本人',true),($6,$7,$8,'ADMIN','active','他社',true)",
    [
      admin,
      org,
      managerRole,
      driver,
      driverRole,
      outsider,
      foreign,
      foreignRole,
    ],
  );
  await rejects(() => saveForm(driver, 0), /record_forbidden/);
  await rejects(() => saveForm(outsider, 0), /record_forbidden/);
  await rejects(
    () => saveForm(admin, 0, { ...form, access: { [foreignRole]: "edit" } }),
    /record_forbidden/,
  );
  await db.exec("SET ROLE service_role");
  await saveForm(admin, 0);
  checks++;
  await rejects(() => saveForm(admin, 0), /record_conflict/);
  await rejects(() => save(driver, 0, 1, "self"), /record_forbidden/);
  await rejects(
    () => save(admin, 0, 1, "staff", { ...payload, reporter: outsider }),
    /record_forbidden/,
  );
  await save(admin, 0);
  checks++;
  await rejects(() => save(admin, 0), /record_conflict/);
  await rejects(
    () => save(admin, 1, 1, "staff", { ...payload, status: "paid" }),
    /record_invalid/,
  );
  form = {
    ...form,
    version: 2,
    statuses: [],
    driver: { submit: true, readOwn: true, editOwn: true, readSubject: true },
  };
  await saveForm(admin, 1);
  checks++;
  await rejects(() => save(admin, 1, 1), /record_conflict/);
  await save(admin, 1, 2, "staff", {
    ...payload,
    status: "resolved",
    note: "解決",
  });
  checks++;
  const old = await query(
    "select form_version,version,status from org_records where id=$1",
    [recordId],
  );
  assert.deepEqual(old.rows[0], {
    form_version: 1,
    version: 2,
    status: "resolved",
  });
  checks++;
  await save(driver, 0, 2, "self", { ...payload, status: "" }, newRecordId);
  checks++;
  await rejects(
    () =>
      save(
        driver,
        1,
        2,
        "self",
        { ...payload, internal: true, note: "内部" },
        newRecordId,
      ),
    /record_forbidden/,
  );
  await rejects(
    () =>
      save(
        driver,
        1,
        2,
        "self",
        { ...payload, status: "", reporter: admin },
        newRecordId,
      ),
    /record_forbidden/,
  );
  await save(admin, 2, 2, "staff", { note: "内部メモ", internal: true });
  checks++;
  await rejects(
    () => save(admin, 2, 2, "staff", { note: "競合", internal: true }),
    /record_conflict/,
  );
  const snapshots = await query(
    "select version,internal,snapshot from org_record_events where record_id=$1 order by version",
    [recordId],
  );
  assert.equal(snapshots.rows.length, 3);
  assert.equal(snapshots.rows[0].snapshot.status, "open");
  assert.equal(snapshots.rows[1].snapshot.status, "resolved");
  assert.equal(snapshots.rows[2].internal, true);
  checks++;
  form = {
    ...form,
    version: 3,
    driver: {
      submit: false,
      readOwn: false,
      editOwn: false,
      readSubject: false,
    },
  };
  await saveForm(admin, 2);
  await rejects(
    () => save(driver, 1, 3, "self", { ...payload, status: "" }, newRecordId),
    /record_forbidden/,
  );
  await db.exec("RESET ROLE");
  await query("update drivers set status='inactive' where id=$1", [admin]);
  await rejects(
    () => save(admin, 3, 3, "staff", { note: "退会後", internal: true }),
    /record_forbidden/,
  );
  await db.exec("SET ROLE anon");
  await rejects(() => query("select * from org_records"), /permission denied/);
  await rejects(() => saveForm(admin, 3), /permission denied/);
  await rejects(
    () => query("select org_record_is_manager($1,$2)", [org, admin]),
    /permission denied/,
  );
  console.log(
    `${checks} SQL checks passed (local PostgreSQL/PGlite; no external DB)`,
  );
} finally {
  await db.close();
}
