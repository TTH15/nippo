import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

const INPUT_TYPES = ["INT", "TEXT", "TIME", "BOOL"];

// POST: 報告フィールド追加
export async function POST(req: NextRequest) {
  const user = await requirePermission(req, "can_manage_carriers");
  if (isAuthError(user)) return user;

  const body = await req.json().catch(() => ({}));
  const unitId = typeof body.unit_id === "string" ? body.unit_id : "";
  const label = typeof body.label === "string" ? body.label.trim() : "";
  const inputType = INPUT_TYPES.includes(body.input_type) ? body.input_type : "INT";
  let fieldKey =
    typeof body.field_key === "string" && body.field_key.trim()
      ? body.field_key.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_")
      : "";

  if (!unitId) return NextResponse.json({ error: "unit_id は必須です" }, { status: 400 });
  if (!label) return NextResponse.json({ error: "ラベルは必須です" }, { status: 400 });
  if (!fieldKey) fieldKey = `field_${Date.now()}`;

  const { data: maxRow } = await supabase
    .from("unit_fields")
    .select("sort_order")
    .eq("unit_id", unitId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = (Number(maxRow?.sort_order) || 0) + 1;

  const { data, error } = await supabase
    .from("unit_fields")
    .insert({
      unit_id: unitId,
      field_key: fieldKey,
      label,
      input_type: inputType,
      group_label: typeof body.group_label === "string" && body.group_label.trim() ? body.group_label.trim() : null,
      is_billable: !!body.is_billable,
      required: !!body.required,
      sort_order: nextOrder,
    })
    .select("*")
    .single();

  if (error) {
    console.error(error);
    const msg = error.code === "23505" ? "この unit 内に同じ field_key が既に存在します" : "DB error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  return NextResponse.json({ field: data });
}
