import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

export type SalesLogTypeRow = {
  id: string;
  name: string;
  sort_order: number;
};

// GET: 種別一覧
export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN_OR_VIEWER");
  if (isAuthError(user)) return user;

  const { data, error } = await supabase
    .from("sales_log_types")
    .select("id, name, sort_order")
    .order("sort_order", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const types = (data ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    sort_order: r.sort_order ?? 0,
  }));

  return NextResponse.json({ types });
}

// POST: 種別を追加
export async function POST(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN");
  if (isAuthError(user)) return user;

  let body: { name?: string; sort_order?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const name = body.name?.trim();
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("sales_log_types")
    .insert({
      name,
      sort_order: typeof body.sort_order === "number" ? body.sort_order : 99,
    })
    .select("id, name, sort_order")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ type: data });
}
