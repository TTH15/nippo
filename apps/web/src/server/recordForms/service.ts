import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/server/db/client";
import { requireAuth, isAuthError } from "@/server/auth";
import {
  expandCapabilities,
  DEFAULT_ROLE_CAPABILITIES,
  type Capability,
} from "@/server/auth/capabilities";
import {
  displayValue,
  type RecordForm,
  type RecordEntry,
  type FormRole,
  type MemberOption,
  type FormGrant,
} from "@/lib/recordForms/model";
import {
  grantFor,
  canRead,
  canEdit,
  visibleSchema,
  type Actor,
  type Scope,
} from "./policy";
import {
  RecordError,
  uuid,
  object,
  integer,
  text,
  parseDefinition,
  parseAnswers,
} from "./validation";

type Row = {
  id: string;
  form_id: string;
  form_version: number;
  version: number;
  answers: RecordEntry["answers"];
  status: string;
  author_id: string;
  reporter_id: string;
  subject_id: string | null;
  member_names: Record<string, string>;
  created_at: string;
};
const columns =
  "id,form_id,form_version,version,answers,status,author_id,reporter_id,subject_id,member_names,created_at";
function check(error: { code?: string; message?: string } | null) {
  if (!error) return;
  if (error.message?.includes("record_forbidden"))
    throw new RecordError("操作する権限がありません", 403);
  if (error.code === "23505" || error.message?.includes("record_conflict"))
    throw new RecordError(
      "他の操作で更新されています。再読み込みして確認してください",
      409,
    );
  if (error.message?.includes("record_invalid"))
    throw new RecordError("入力内容を確認してください");
  console.error("[recordForms] database failure", error.code);
  throw new RecordError(
    "記録機能を利用できません。しばらくして再度お試しください",
    503,
  );
}
export async function endpoint(action: () => Promise<unknown>) {
  try {
    return NextResponse.json(await action(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    if (e instanceof RecordError)
      return NextResponse.json(
        { error: e.message },
        { status: e.status, headers: { "Cache-Control": "no-store" } },
      );
    console.error(
      "[recordForms] request failure",
      e instanceof Error ? e.name : "unknown",
    );
    return NextResponse.json({ error: "処理に失敗しました" }, { status: 500 });
  }
}
export async function readBody(req: NextRequest) {
  const reader = req.body?.getReader();
  if (!reader) throw new RecordError("入力がありません");
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 512000) {
      await reader.cancel();
      throw new RecordError("入力が大きすぎます", 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.length;
  }
  try {
    return object(JSON.parse(new TextDecoder().decode(bytes)));
  } catch (e) {
    if (e instanceof RecordError) throw e;
    throw new RecordError("入力形式が不正です");
  }
}
export async function context(
  req: NextRequest,
): Promise<{ actor: Actor; scope: Scope }> {
  const auth = await requireAuth(req);
  if (isAuthError(auth)) throw new RecordError("ログインしてください", 401);
  const { data: d, error } = await supabase
    .from("drivers")
    .select("id,org_id,role_id,role,status,name,works_as_driver")
    .eq("id", auth.driverId)
    .maybeSingle();
  check(error);
  if (!d?.org_id || d.status !== "active")
    throw new RecordError("利用できる組織がありません", 403);
  const { data: org, error: oe } = await supabase
    .from("organizations")
    .select("status")
    .eq("id", d.org_id)
    .maybeSingle();
  check(oe);
  if (org?.status !== "active")
    throw new RecordError("この組織は利用できません", 403);
  let caps: Capability[] = DEFAULT_ROLE_CAPABILITIES[d.role] ?? [];
  if (d.role_id) {
    const { data: r, error: re } = await supabase
      .from("roles")
      .select("id")
      .eq("id", d.role_id)
      .eq("org_id", d.org_id)
      .maybeSingle();
    check(re);
    if (!r) throw new RecordError("ロールを確認してください", 403);
    const { data: c, error: ce } = await supabase
      .from("role_capabilities")
      .select("capability")
      .eq("role_id", d.role_id);
    check(ce);
    caps = (c ?? []).map((v) => v.capability as Capability);
  }
  const manager = expandCapabilities(caps).has("can_manage_record_forms");
  const scope = req.nextUrl.searchParams.get("scope") ?? "self";
  if (scope !== "staff" && scope !== "self" && scope !== "manage")
    throw new RecordError("表示範囲が不正です");
  if (scope === "manage" && !manager)
    throw new RecordError("フォーム管理の権限がありません", 403);
  return {
    actor: {
      id: d.id,
      orgId: d.org_id,
      roleId: d.role_id,
      name: d.name,
      manager,
      worksAsDriver: d.works_as_driver === true || d.role === "DRIVER",
    },
    scope,
  };
}
async function rolesFor(actor: Actor): Promise<FormRole[]> {
  const { data, error } = await supabase
    .from("roles")
    .select("id,label,role_capabilities(capability)")
    .eq("org_id", actor.orgId)
    .order("sort_order");
  check(error);
  return (data ?? []).map((r) => ({
    id: r.id,
    label: r.label,
    manager: expandCapabilities(
      r.role_capabilities.map((c) => c.capability as Capability),
    ).has("can_manage_record_forms"),
  }));
}
async function membersFor(actor: Actor, scope: Scope): Promise<MemberOption[]> {
  if (scope === "self") return [{ value: actor.id, label: actor.name }];
  const { data, error } = await supabase
    .from("drivers")
    .select("id,name")
    .eq("org_id", actor.orgId)
    .eq("status", "active")
    .order("name")
    .limit(1000);
  check(error);
  return (data ?? []).map((d) => ({ value: d.id, label: d.name }));
}
async function getForm(actor: Actor, id: string): Promise<RecordForm> {
  uuid(id);
  const { data, error } = await supabase
    .from("org_record_forms")
    .select("definition")
    .eq("org_id", actor.orgId)
    .eq("id", id)
    .maybeSingle();
  check(error);
  if (!data) throw new RecordError("フォームが見つかりません", 404);
  return data.definition as RecordForm;
}
export async function bootstrap(req: NextRequest) {
  const { actor, scope } = await context(req);
  const { data, error } = await supabase
    .from("org_record_forms")
    .select("definition")
    .eq("org_id", actor.orgId)
    .order("created_at");
  check(error);
  const forms = (data ?? [])
    .map((r) => r.definition as RecordForm)
    .filter(
      (f) =>
        scope === "manage" ||
        Object.values(grantFor(f, actor, scope)).some(Boolean),
    );
  const allowMembers =
    scope === "manage" ||
    forms.some((f) => {
      const g = grantFor(f, actor, scope);
      return g.readAll || g.create;
    });
  return {
    actor: { id: actor.id, name: actor.name },
    canConfigure: actor.manager,
    forms: forms.map((f) =>
      visibleSchema(f, actor.manager && scope !== "self"),
    ),
    grants: Object.fromEntries(
      forms.map((f) => [f.id, grantFor(f, actor, scope)]),
    ),
    members: allowMembers ? await membersFor(actor, scope) : [],
    roles: actor.manager && scope !== "self" ? await rolesFor(actor) : [],
  };
}
export async function saveForm(req: NextRequest, id?: string) {
  const { actor } = await context(req);
  if (!actor.manager)
    throw new RecordError("フォーム管理の権限がありません", 403);
  const body = await readBody(req);
  const expected = id ? integer(body.expectedVersion) : 0;
  const form = parseDefinition(body.form, await rolesFor(actor));
  if (id && uuid(id) !== form.id)
    throw new RecordError("フォームIDが一致しません");
  if (form.version !== expected + 1)
    throw new RecordError("フォームの版が一致しません", 409);
  const { error } = await supabase.rpc("save_org_record_form", {
    p_org: actor.orgId,
    p_actor: actor.id,
    p_id: form.id,
    p_expected: expected,
    p_definition: form,
  });
  check(error);
  return { form };
}
async function savedSchema(actor: Actor, row: Row) {
  const { data, error } = await supabase
    .from("org_record_form_versions")
    .select("definition")
    .eq("org_id", actor.orgId)
    .eq("form_id", row.form_id)
    .eq("version", row.form_version)
    .single();
  check(error);
  return data!.definition as RecordForm;
}
function dto(
  row: Row,
  schema: RecordForm,
  actor: Actor,
  scope: Scope,
  history: RecordEntry["history"] = [],
): RecordEntry {
  return {
    id: row.id,
    formId: row.form_id,
    schema: visibleSchema(schema, actor.manager && scope !== "self"),
    answers: row.answers,
    status: row.status,
    author: row.author_id,
    reporter: row.reporter_id,
    createdAt: row.created_at,
    version: row.version,
    memberNames: row.member_names,
    history,
  };
}
function ownQuery(g: FormGrant, actor: Actor) {
  const parts = [];
  if (g.readOwn) parts.push(`author_id.eq.${uuid(actor.id)}`);
  if (g.readSubject) parts.push(`subject_id.eq.${uuid(actor.id)}`);
  return parts.join(",");
}
export async function listRecords(req: NextRequest, formId: string) {
  const { actor, scope } = await context(req);
  const form = await getForm(actor, formId),
    grant = grantFor(form, actor, scope);
  if (!grant.readAll && !grant.readOwn && !grant.readSubject) {
    if (grant.create) return { records: [], hasMore: false };
    throw new RecordError("閲覧する権限がありません", 403);
  }
  const page = Number(req.nextUrl.searchParams.get("page") ?? 1);
  integer(page);
  if (page > 10000) throw new RecordError("ページ番号が不正です");
  let query = supabase
    .from("org_records")
    .select(columns)
    .eq("org_id", actor.orgId)
    .eq("form_id", formId);
  if (!grant.readAll) query = query.or(ownQuery(grant, actor));
  const q = text(req.nextUrl.searchParams.get("q") ?? "", 100);
  if (q)
    query = query.ilike("search_text", `%${q.replace(/[\\%_]/g, "\\$&")}%`);
  const status = req.nextUrl.searchParams.get("status");
  if (status) {
    if (!["open", "progress", "resolved"].includes(status))
      throw new RecordError("対応状況が不正です");
    query = query.eq("status", status);
  }
  for (const [param, op] of [
    ["from", "gte"],
    ["to", "lte"],
  ] as const) {
    const date = req.nextUrl.searchParams.get(param);
    if (date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)))
        throw new RecordError("日付が不正です");
      query = query[op]("record_date", date);
    }
  }
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range((page - 1) * 30, page * 30);
  check(error);
  const rows = (data ?? []) as Row[];
  const versions = [...new Set(rows.slice(0, 30).map((r) => r.form_version))];
  const schemas = new Map<number, RecordForm>();
  if (versions.length) {
    const { data: v, error: ve } = await supabase
      .from("org_record_form_versions")
      .select("version,definition")
      .eq("org_id", actor.orgId)
      .eq("form_id", formId)
      .in("version", versions);
    check(ve);
    for (const s of v ?? []) schemas.set(s.version, s.definition as RecordForm);
  }
  return {
    records: rows
      .slice(0, 30)
      .map((r) => dto(r, schemas.get(r.form_version)!, actor, scope)),
    hasMore: rows.length > 30,
  };
}
async function getRow(actor: Actor, formId: string, id: string) {
  uuid(id);
  const { data, error } = await supabase
    .from("org_records")
    .select(columns)
    .eq("org_id", actor.orgId)
    .eq("form_id", formId)
    .eq("id", id)
    .maybeSingle();
  check(error);
  if (!data) throw new RecordError("記録が見つかりません", 404);
  return data as Row;
}
export async function getRecord(req: NextRequest, formId: string, id: string) {
  const { actor, scope } = await context(req);
  const form = await getForm(actor, formId),
    grant = grantFor(form, actor, scope),
    row = await getRow(actor, formId, id);
  if (!canRead(grant, actor.id, row.author_id, row.subject_id))
    throw new RecordError("記録が見つかりません", 404);
  let query = supabase
    .from("org_record_events")
    .select("version,actor_id,actor_name,text,internal,created_at")
    .eq("org_id", actor.orgId)
    .eq("form_id", formId)
    .eq("record_id", id);
  if (scope === "self") query = query.eq("internal", false);
  const { data, error } = await query
    .order("version", { ascending: false })
    .limit(100);
  check(error);
  const names = { ...row.member_names };
  for (const e of data ?? []) names[e.actor_id] = e.actor_name;
  return {
    record: dto(
      { ...row, member_names: names },
      await savedSchema(actor, row),
      actor,
      scope,
      (data ?? [])
        .reverse()
        .map((e) => ({
          id: String(e.version),
          at: e.created_at,
          by: e.actor_id,
          text: e.text,
          internal: e.internal,
        })),
    ),
    editable: canEdit(grant, actor.id, row.author_id),
    historyLimit: 100,
  };
}
export async function saveRecord(
  req: NextRequest,
  formId: string,
  id?: string,
) {
  const { actor, scope } = await context(req);
  if (scope === "manage") throw new RecordError("記録画面から保存してください");
  const form = await getForm(actor, formId),
    grant = grantFor(form, actor, scope);
  const body = await readBody(req);
  const expected = id ? integer(body.expectedVersion) : 0;
  const recordId = id ? uuid(id) : uuid(body.id);
  const formVersion = integer(body.formVersion);
  if (formVersion !== form.version)
    throw new RecordError(
      "フォーム設定が更新されました。再読み込みして確認してください",
      409,
    );
  const row = id ? await getRow(actor, formId, id) : null;
  if (row ? !canEdit(grant, actor.id, row.author_id) : !grant.create)
    throw new RecordError("保存する権限がありません", 403);
  const internal = body.internal === true;
  if (internal && (!row || scope !== "staff"))
    throw new RecordError("運営専用の追記は利用できません", 403);
  const note = text(body.note ?? "", 2000, !!row);
  const schema = row ? await savedSchema(actor, row) : form;
  let payload: Record<string, unknown> = {
    note: row ? note : "記録を作成",
    internal,
  };
  if (!internal) {
    const members = await membersFor(actor, scope);
    // 無効化済みのメンバーは既存の値を変えない場合に限り維持できる。
    if (row)
      for (const f of schema.fields.filter((f) => f.type === "member")) {
        const old = row.answers[f.id];
        if (
          typeof old === "string" &&
          old &&
          object(body.answers)[f.id] === old &&
          !members.some((m) => m.value === old)
        )
          members.push({
            value: old,
            label: row.member_names[old] ?? "退会済みメンバー",
          });
      }
    const answers = parseAnswers(schema, body.answers, members);
    const reporter =
      scope === "self"
        ? (row?.reporter_id ?? actor.id)
        : uuid(body.reporter ?? actor.id);
    if (
      scope !== "self" &&
      reporter !== row?.reporter_id &&
      !members.some((m) => m.value === reporter)
    )
      throw new RecordError("この組織の報告者を選択してください");
    const status =
      scope === "self"
        ? (row?.status ?? schema.statuses[0]?.id ?? "")
        : text(body.status ?? "", 20);
    if (
      schema.statuses.length
        ? !schema.statuses.some((s) => s.id === status)
        : status !== ""
    )
      throw new RecordError("対応状況を選び直してください");
    const used = new Set([
      actor.id,
      row?.author_id ?? actor.id,
      reporter,
      ...schema.fields
        .filter((f) => f.type === "member")
        .map((f) => String(answers[f.id] ?? ""))
        .filter(Boolean),
    ]);
    const names: Record<string, string> = {};
    for (const key of used)
      names[key] =
        members.find((m) => m.value === key)?.label ??
        row?.member_names[key] ??
        actor.name;
    payload = {
      ...payload,
      answers,
      reporter,
      status,
      memberNames: names,
      searchText: schema.fields
        .map((f) => displayValue(f, answers[f.id], members))
        .join("\n")
        .slice(0, 200000),
    };
  }
  const { data: version, error } = await supabase.rpc("save_org_record", {
    p_org: actor.orgId,
    p_actor: actor.id,
    p_form: formId,
    p_id: recordId,
    p_form_version: formVersion,
    p_expected: expected,
    p_scope: scope,
    p_payload: payload,
  });
  check(error);
  return { id: recordId, version };
}
