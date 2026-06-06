import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";
import { normalizeCapability } from "@/server/reportKinds/config";

export const dynamic = "force-dynamic";

// PATCH: 種別を更新（key は不変＝既存報告との対応を保つ）。
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireAuth(req, "ADMIN");
  if (isAuthError(user)) return user;
  const { id } = await params;

  const body = await req.json().catch(() => ({}));

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if ("label" in body) {
    const label = String(body.label ?? "").trim();
    if (!label) return NextResponse.json({ error: "表示名は必須です。" }, { status: 400 });
    updates.label = label;
  }
  if ("sortOrder" in body && Number.isFinite(Number(body.sortOrder))) updates.sort_order = Math.trunc(Number(body.sortOrder));
  if ("isActive" in body) updates.is_active = body.isActive === true;
  if ("usesLocation" in body) updates.uses_location = body.usesLocation === true;
  if ("usesOdometer" in body) updates.uses_odometer = body.usesOdometer === true;
  if ("usesDescription" in body) updates.uses_description = body.usesDescription === true;
  if ("usesAmount" in body) updates.uses_amount = body.usesAmount === true;
  if ("descriptionRequired" in body) updates.description_required = body.descriptionRequired === true;
  if ("descriptionLabel" in body)
    updates.description_label = typeof body.descriptionLabel === "string" && body.descriptionLabel.trim() ? body.descriptionLabel.trim() : null;
  if ("capability" in body) updates.capability = normalizeCapability(body.capability);

  // 能力とフィールドの整合性チェック（更新後の値で判定）。
  const { data: current, error: curErr } = await supabase
    .from("report_kinds")
    .select("uses_odometer, uses_amount, capability")
    .eq("id", id)
    .maybeSingle();
  if (curErr || !current) return NextResponse.json({ error: "種別が見つかりません。" }, { status: 404 });
  const nextCap = (updates.capability as string) ?? current.capability;
  const nextOdo = "uses_odometer" in updates ? (updates.uses_odometer as boolean) : current.uses_odometer;
  const nextAmt = "uses_amount" in updates ? (updates.uses_amount as boolean) : current.uses_amount;
  if (nextCap === "oil_mileage" && !nextOdo)
    return NextResponse.json({ error: "「車両距離更新」には走行距離フィールドが必要です。" }, { status: 400 });
  if (nextCap === "expense" && !nextAmt)
    return NextResponse.json({ error: "「経費連携」には金額フィールドが必要です。" }, { status: 400 });

  const { data, error } = await supabase.from("report_kinds").update(updates).eq("id", id).select("*").maybeSingle();
  if (error) {
    console.error("[admin/report-kinds/:id] update error", error);
    return NextResponse.json({ error: "更新に失敗しました。" }, { status: 500 });
  }
  return NextResponse.json({ kind: data });
}

// DELETE: 種別を削除。既存の報告データは text の report_kind を保持（ラベルはキー表示にフォールバック）。
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireAuth(req, "ADMIN");
  if (isAuthError(user)) return user;
  const { id } = await params;
  const { error } = await supabase.from("report_kinds").delete().eq("id", id);
  if (error) {
    console.error("[admin/report-kinds/:id] delete error", error);
    return NextResponse.json({ error: "削除に失敗しました。" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
