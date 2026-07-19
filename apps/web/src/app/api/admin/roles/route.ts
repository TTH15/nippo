import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { CAPABILITIES, PERMISSION_ROWS, type Capability } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

// ============================================================
// ロール・権限管理（§2-6）。
// GET: org のロール一覧＋各ロールの capability ＋ capability カタログ（UI 用）。
// POST: カスタムロールを新規作成（label＋capabilities）。key は自動採番。
// 読み取り=can_view_members / 書き込み=can_manage_members でゲート。
// ============================================================

const VALID = new Set<string>(CAPABILITIES);

// org 内で一意な key を採番（カスタムロール用）。CUSTOM_XXXXX。
function genRoleKey(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 紛らわしい文字を除外
  let s = "";
  for (let i = 0; i < 5; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `CUSTOM_${s}`;
}

export async function GET(req: NextRequest) {
  const user = await requirePermission(req, "can_view_members");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);

  const { data: roles, error } = await supabase
    .from("roles")
    .select("id, key, label, is_system, sort_order, works_as_driver")
    .eq("org_id", orgId)
    .order("sort_order", { ascending: true });
  if (error) {
    console.error("[roles] list error", error);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }

  const roleIds = (roles ?? []).map((r) => r.id);
  const { data: caps } = roleIds.length
    ? await supabase.from("role_capabilities").select("role_id, capability").in("role_id", roleIds)
    : { data: [] as { role_id: string; capability: string }[] };
  const byRole = new Map<string, string[]>();
  for (const c of caps ?? []) {
    const arr = byRole.get(c.role_id) ?? [];
    arr.push(c.capability);
    byRole.set(c.role_id, arr);
  }

  // 割当 UI（ロールごとのメンバー表示・D&D）用に active メンバーを返す。
  const { data: members } = await supabase
    .from("drivers")
    .select("id, name, role_id")
    .eq("org_id", orgId)
    .eq("status", "active")
    .order("name", { ascending: true });

  return NextResponse.json({
    roles: (roles ?? []).map((r) => ({
      id: r.id,
      key: r.key,
      label: r.label,
      isSystem: r.is_system,
      sortOrder: r.sort_order,
      worksAsDriver: r.works_as_driver,
      capabilities: byRole.get(r.id) ?? [],
    })),
    members: (members ?? []).map((m) => ({ id: m.id, name: m.name, roleId: m.role_id })),
    // 権限設定 UI の行定義（Discord 風の 許可なし/閲覧のみ/編集可能）
    rows: PERMISSION_ROWS,
  });
}

export async function POST(req: NextRequest) {
  const user = await requirePermission(req, "can_manage_members");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);

  try {
    const body = await req.json();
    const label = typeof body.label === "string" ? body.label.trim() : "";
    const capabilities: string[] = Array.isArray(body.capabilities) ? body.capabilities : [];
    const worksAsDriver = body.worksAsDriver === true;
    if (!label) return NextResponse.json({ error: "ロール名を入力してください" }, { status: 400 });
    const invalid = capabilities.filter((c) => !VALID.has(c));
    if (invalid.length) return NextResponse.json({ error: `未知の権限: ${invalid.join(", ")}` }, { status: 400 });

    // 末尾に並べる sort_order
    const { data: maxRow } = await supabase
      .from("roles")
      .select("sort_order")
      .eq("org_id", orgId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const sortOrder = (maxRow?.sort_order ?? 0) + 10;

    // key 一意リトライ
    let roleId: string | null = null;
    for (let attempt = 0; attempt < 5 && !roleId; attempt++) {
      const key = genRoleKey();
      const { data, error } = await supabase
        .from("roles")
        .insert({ org_id: orgId, key, label, is_system: false, sort_order: sortOrder, works_as_driver: worksAsDriver })
        .select("id")
        .single();
      if (!error && data) roleId = data.id;
      else if (error && error.code !== "23505") {
        console.error("[roles] create error", error);
        return NextResponse.json({ error: "作成に失敗しました" }, { status: 500 });
      }
    }
    if (!roleId) return NextResponse.json({ error: "作成に失敗しました（key 採番）" }, { status: 500 });

    const rows = (capabilities as Capability[]).map((c) => ({ role_id: roleId!, capability: c }));
    if (rows.length) {
      const { error: capErr } = await supabase.from("role_capabilities").insert(rows);
      if (capErr) {
        console.error("[roles] capability insert error", capErr);
        return NextResponse.json({ error: "権限の保存に失敗しました" }, { status: 500 });
      }
    }
    return NextResponse.json({ ok: true, id: roleId });
  } catch (err) {
    console.error("[roles] POST", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
