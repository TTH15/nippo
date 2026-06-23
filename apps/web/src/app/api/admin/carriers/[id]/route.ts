import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { orgOwnsCarrier } from "@/server/carriers/orgCarriers";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

const NOT_FOUND = NextResponse.json({ error: "キャリアが見つかりません" }, { status: 404 });

// PATCH: キャリア更新（name / code / sort_order / active）
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireAuth(req, "ADMIN");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);
  const { id } = await params;
  if (!(await orgOwnsCarrier(supabase, orgId, id))) return NOT_FOUND;

  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};
  if (typeof body.name === "string") patch.name = body.name.trim();
  if ("code" in body) patch.code = body.code ? String(body.code).trim() : null;
  if (typeof body.sort_order === "number") patch.sort_order = Math.floor(body.sort_order);
  if (typeof body.active === "boolean") patch.active = body.active;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "更新項目がありません" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("carriers")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    console.error(error);
    const msg = error.code === "23505" ? "同名/同コードのキャリアが既に存在します" : "DB error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  return NextResponse.json({ carrier: data });
}

// DELETE: キャリア削除（依存があればハード削除を拒否し、無効化を促す）
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireAuth(req, "ADMIN");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);
  const { id } = await params;
  if (!(await orgOwnsCarrier(supabase, orgId, id))) return NOT_FOUND;

  // 配下に unit があれば削除不可（unit を先に消す/無効化）
  const { count: unitCount } = await supabase
    .from("units")
    .select("id", { count: "exact", head: true })
    .eq("carrier_id", id);
  // 既存日報がこのキャリアを参照していないか
  const { count: reportCount } = await supabase
    .from("daily_reports_v2")
    .select("id", { count: "exact", head: true })
    .eq("carrier_id", id);

  if ((unitCount ?? 0) > 0 || (reportCount ?? 0) > 0) {
    return NextResponse.json(
      {
        error:
          "このキャリアは利用中のため削除できません（unit または日報が紐づいています）。無効化してください。",
      },
      { status: 409 },
    );
  }

  // 有効化(company_carriers)を先に解除（carriers への FK のため）。
  await supabase.from("company_carriers").delete().eq("carrier_id", id);

  const { error } = await supabase.from("carriers").delete().eq("id", id);
  if (error) {
    console.error(error);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
