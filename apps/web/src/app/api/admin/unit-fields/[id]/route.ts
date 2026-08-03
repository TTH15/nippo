import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

const INPUT_TYPES = ["INT", "TEXT", "TIME", "BOOL"];

// PATCH: 報告フィールド更新
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requirePermission(req, "can_manage_carriers");
  if (isAuthError(user)) return user;
  const { id } = await params;

  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};
  if (typeof body.label === "string") patch.label = body.label.trim();
  if (INPUT_TYPES.includes(body.input_type)) patch.input_type = body.input_type;
  if ("group_label" in body) patch.group_label = body.group_label ? String(body.group_label).trim() : null;
  if (typeof body.is_billable === "boolean") patch.is_billable = body.is_billable;
  if (typeof body.required === "boolean") patch.required = body.required;
  if (typeof body.sort_order === "number") patch.sort_order = Math.floor(body.sort_order);

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "更新項目がありません" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("unit_fields")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    console.error(error);
    return NextResponse.json({ error: "DB error" }, { status: 400 });
  }
  return NextResponse.json({ field: data });
}

// DELETE: 報告フィールド削除（report_entries は field_key 文字列参照のため FK 連鎖なし）
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requirePermission(req, "can_manage_carriers");
  if (isAuthError(user)) return user;
  const { id } = await params;

  const { error } = await supabase.from("unit_fields").delete().eq("id", id);
  if (error) {
    console.error(error);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
