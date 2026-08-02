import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

// ============================================================
// 単回招待リンク管理API（運営・§2-1a）。
// GET: 当 org の招待一覧（未使用・使用済み・期限切れの状態付き、新しい順）。
// POST: 招待を発行（氏名プリフィルは任意）。トークンは 128bit ランダム hex。
// 失効は [id]/route.ts の DELETE。
// ============================================================

const INVITE_TTL_DAYS = 7;

type InviteRow = {
  id: string;
  name: string | null;
  token: string;
  created_at: string;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
};

const inviteStatus = (r: InviteRow): "active" | "used" | "expired" | "revoked" => {
  if (r.revoked_at) return "revoked";
  if (r.used_at) return "used";
  if (new Date(r.expires_at).getTime() < Date.now()) return "expired";
  return "active";
};

export async function GET(req: NextRequest) {
  const user = await requirePermission(req, "can_view_members");
  if (isAuthError(user)) return user;
  const orgId = user.orgId ?? (await resolveOrgId(user.driverId));

  const { data, error } = await supabase
    .from("invites")
    .select("id, name, token, created_at, expires_at, used_at, revoked_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    console.error("[admin/invites] list", error);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }
  const invites = ((data ?? []) as InviteRow[]).map((r) => ({
    id: r.id,
    name: r.name ?? "",
    token: r.token,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    status: inviteStatus(r),
  }));
  return NextResponse.json({ invites });
}

export async function POST(req: NextRequest) {
  const user = await requirePermission(req, "can_approve_members");
  if (isAuthError(user)) return user;
  const orgId = user.orgId ?? (await resolveOrgId(user.driverId));

  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 60) : "";

  const token = randomBytes(16).toString("hex");
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("invites")
    .insert({
      org_id: orgId,
      token,
      name: name || null,
      created_by: user.driverId,
      expires_at: expiresAt,
    })
    .select("id, name, token, created_at, expires_at")
    .single();
  if (error || !data) {
    console.error("[admin/invites] create", error);
    return NextResponse.json({ error: "招待の発行に失敗しました" }, { status: 500 });
  }
  return NextResponse.json({
    invite: {
      id: data.id,
      name: data.name ?? "",
      token: data.token,
      createdAt: data.created_at,
      expiresAt: data.expires_at,
      status: "active" as const,
    },
  });
}
