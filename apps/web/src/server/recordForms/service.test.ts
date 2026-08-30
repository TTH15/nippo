import { beforeEach, describe, it, expect, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock("@/server/auth", () => ({
  requireAuth: mocks.auth,
  isAuthError: (v: unknown) => v instanceof NextResponse,
}));
vi.mock("@/server/db/client", () => ({
  supabase: { from: mocks.from, rpc: mocks.rpc },
}));
import {
  bootstrap,
  endpoint,
  getRecord,
  listRecords,
  saveRecord,
  saveForm,
} from "./service";
import { makeTemplate } from "@/lib/recordForms/model";
const org = "11111111-1111-4111-8111-111111111111",
  actor = "22222222-2222-4222-8222-222222222222",
  formId = "33333333-3333-4333-8333-333333333333",
  id = "44444444-4444-4444-8444-444444444444",
  other = "55555555-5555-4555-8555-555555555555";
const form = () => ({
  ...makeTemplate("memo", formId),
  access: {},
  driver: { submit: true, readOwn: true, editOwn: true, readSubject: true },
  subjectField: "subject",
  fields: [
    ...makeTemplate("memo", formId).fields,
    {
      id: "subject",
      label: "対象者",
      type: "member" as const,
      required: false,
    },
  ],
});
const row = () => ({
  id,
  form_id: formId,
  form_version: 1,
  version: 1,
  answers: { title: "題", date: "2026-08-31", body: "本文", subject: actor },
  status: "",
  author_id: actor,
  reporter_id: actor,
  subject_id: actor,
  member_names: { [actor]: "本人" },
  created_at: "2026-08-31T00:00:00Z",
});
function query(data: unknown, error: unknown = null) {
  const q: Record<string, any> = {};
  for (const m of [
    "select",
    "eq",
    "order",
    "range",
    "limit",
    "or",
    "ilike",
    "gte",
    "lte",
    "in",
    "maybeSingle",
    "single",
  ])
    q[m] = vi.fn(() => q);
  q.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data, error }).then(resolve);
  return q;
}
const queries: Record<string, ReturnType<typeof query>[]> = {};
const calls: Record<string, ReturnType<typeof query>[]> = {};
function enqueue(table: string, data: unknown, error: unknown = null) {
  const q = query(data, error);
  (queries[table] ??= []).push(q);
  return q;
}
function req(body?: unknown, scope = "self", suffix = "") {
  return new NextRequest(
    `http://localhost/api/record-forms?scope=${scope}${suffix}`,
    body === undefined
      ? undefined
      : { method: "POST", body: JSON.stringify(body) },
  );
}
function setup(manager = false) {
  enqueue("drivers", {
    id: actor,
    org_id: org,
    role_id: null,
    role: manager ? "ADMIN" : "DRIVER",
    status: "active",
    name: "本人",
    works_as_driver: true,
  });
  enqueue("organizations", { status: "active" });
}
beforeEach(() => {
  vi.resetAllMocks();
  for (const k of Object.keys(queries)) delete queries[k];
  for (const k of Object.keys(calls)) delete calls[k];
  mocks.auth.mockResolvedValue({
    driverId: actor,
    orgId: other,
    role: "ADMIN",
  });
  mocks.from.mockImplementation((table) => {
    const q = queries[table]?.shift();
    if (!q) throw Error(`unexpected table ${table}`);
    (calls[table] ??= []).push(q);
    return q;
  });
  mocks.rpc.mockResolvedValue({ data: 1, error: null });
});
describe("記録APIの組織・権限境界", () => {
  it("未ログインはDBに接続しない", async () => {
    mocks.auth.mockResolvedValue(NextResponse.json({}, { status: 401 }));
    expect((await endpoint(() => bootstrap(req()))).status).toBe(401);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("停止済みメンバーはJWTの管理者属性でも拒否", async () => {
    enqueue("drivers", {
      id: actor,
      org_id: org,
      status: "inactive",
      role: "ADMIN",
    });
    expect((await endpoint(() => bootstrap(req()))).status).toBe(403);
  });
  it("一覧はトークンのorgでなく現在のorgと本人で絞る", async () => {
    setup();
    enqueue("org_record_forms", { definition: form() });
    const q = enqueue("org_records", []);
    expect(
      (
        await endpoint(() =>
          listRecords(req(undefined, "self", "&q=100%25_%5C"), formId),
        )
      ).status,
    ).toBe(200);
    expect(q.eq).toHaveBeenCalledWith("org_id", org);
    expect(q.eq).toHaveBeenCalledWith("form_id", formId);
    expect(q.or).toHaveBeenCalledWith(
      `author_id.eq.${actor},subject_id.eq.${actor}`,
    );
    expect(q.ilike).toHaveBeenCalledWith("search_text", "%100\\%\\_\\\\%");
  });
  it("他人の詳細に対して履歴を問い合わせない", async () => {
    setup();
    enqueue("org_record_forms", { definition: form() });
    enqueue("org_records", { ...row(), author_id: other, subject_id: other });
    expect((await endpoint(() => getRecord(req(), formId, id))).status).toBe(
      404,
    );
    expect(calls.org_record_events).toBeUndefined();
  });
  it("本人向け履歴はDB問い合わせ時点で運営専用を除く", async () => {
    setup();
    enqueue("org_record_forms", { definition: form() });
    enqueue("org_records", row());
    const q = enqueue("org_record_events", []);
    enqueue("org_record_form_versions", { definition: form() });
    const response = await endpoint(() => getRecord(req(), formId, id));
    expect(response.status).toBe(200);
    expect(q.eq).toHaveBeenCalledWith("internal", false);
    expect(q.eq).toHaveBeenCalledWith("org_id", org);
    expect(q.select).not.toHaveBeenCalledWith(
      expect.stringContaining("snapshot"),
    );
    expect((await response.json()).record.schema.access).toEqual({});
  });
  it("本人からの運営専用追記を拒否", async () => {
    setup();
    enqueue("org_record_forms", { definition: form() });
    enqueue("org_records", row());
    expect(
      (
        await endpoint(() =>
          saveRecord(
            req({
              expectedVersion: 1,
              formVersion: 1,
              note: "hidden",
              internal: true,
            }),
            formId,
            id,
          ),
        )
      ).status,
    ).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("本人以外のメンバー指定を拒否", async () => {
    setup();
    enqueue("org_record_forms", { definition: form() });
    expect(
      (
        await endpoint(() =>
          saveRecord(
            req({
              id,
              formVersion: 1,
              answers: { ...row().answers, subject: other },
            }),
            formId,
          ),
        )
      ).status,
    ).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("記入者・報告者・orgの偽装を採用しない", async () => {
    setup();
    enqueue("org_record_forms", { definition: form() });
    expect(
      (
        await endpoint(() =>
          saveRecord(
            req({
              id,
              formVersion: 1,
              answers: row().answers,
              reporter: other,
              author: other,
              orgId: other,
              status: "resolved",
            }),
            formId,
          ),
        )
      ).status,
    ).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "save_org_record",
      expect.objectContaining({
        p_org: org,
        p_actor: actor,
        p_payload: expect.objectContaining({ reporter: actor, status: "" }),
      }),
    );
    expect(mocks.from.mock.calls.map((c) => c[0])).toEqual([
      "drivers",
      "organizations",
      "org_record_forms",
    ]);
  });
  it("古い設定からの新規保存は409", async () => {
    setup();
    enqueue("org_record_forms", { definition: { ...form(), version: 2 } });
    expect(
      (
        await endpoint(() =>
          saveRecord(
            req({ id, formVersion: 1, answers: row().answers }),
            formId,
          ),
        )
      ).status,
    ).toBe(409);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("同時更新のRPC失敗を409にする", async () => {
    setup();
    enqueue("org_record_forms", { definition: form() });
    mocks.rpc.mockResolvedValue({ error: { message: "record_conflict" } });
    expect(
      (
        await endpoint(() =>
          saveRecord(
            req({ id, formVersion: 1, answers: row().answers }),
            formId,
          ),
        )
      ).status,
    ).toBe(409);
  });
  it("フォーム設定権限をJWTだけでは得られない", async () => {
    setup();
    expect((await endpoint(() => saveForm(req({ form: form() })))).status).toBe(
      403,
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("運営閲覧の権限がないと記録テーブルへ進まない", async () => {
    setup();
    enqueue("org_record_forms", { definition: form() });
    expect(
      (await endpoint(() => listRecords(req(undefined, "staff"), formId)))
        .status,
    ).toBe(403);
    expect(calls.org_records).toBeUndefined();
  });
});
