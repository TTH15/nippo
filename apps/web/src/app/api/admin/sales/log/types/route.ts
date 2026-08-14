import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission, isAuthError } from "@/server/auth";
import { SALES_LOG_TYPES_VIEW_CAPS, SALES_LOG_TYPES_MANAGE_CAPS } from "@/server/auth/domainCaps";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

export type SalesLogTypeRow = {
  id: string;
  name: string;
  sort_order: number;
};

// GET: 種別一覧
export async function GET(req: NextRequest) {
  // 種別の編集UIは売上（請求領域）のログタブにある（domainCaps 参照・2026-08-14 権限監査）
  const user = await requireAnyPermission(req, SALES_LOG_TYPES_VIEW_CAPS);
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
  const user = await requireAnyPermission(req, SALES_LOG_TYPES_MANAGE_CAPS);
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
