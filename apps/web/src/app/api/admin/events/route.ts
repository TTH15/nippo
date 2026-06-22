import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

// GET: イベント一覧
export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN_OR_VIEWER");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);

  const { data, error } = await supabase
    .from("events")
    .select("id, name, description, starts_on, ends_on, status, created_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }
  return NextResponse.json({ events: data ?? [] });
}

// POST: イベント作成
export async function POST(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);

  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "イベント名は必須です" }, { status: 400 });
  }

  const insertRow: Record<string, unknown> = {
    org_id: orgId,
    name,
    description: typeof body.description === "string" ? body.description : "",
    starts_on: body.starts_on || null,
    ends_on: body.ends_on || null,
    status: "draft",
  };

  const { data, error } = await supabase
    .from("events")
    .insert(insertRow)
    .select("id, name, description, starts_on, ends_on, status, created_at")
    .single();

  if (error) {
    console.error(error);
    return NextResponse.json({ error: "作成に失敗しました" }, { status: 500 });
  }
  return NextResponse.json({ event: data });
}
