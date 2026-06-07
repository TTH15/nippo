import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";
import { loadReportKinds, normalizeCapability } from "@/server/reportKinds/config";

export const dynamic = "force-dynamic";

// GET: 全種別（管理画面の設定用）。
export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN_OR_VIEWER");
  if (isAuthError(user)) return user;
  const kinds = await loadReportKinds(supabase);
  return NextResponse.json({ kinds });
}

const KEY_RE = /^[a-z][a-z0-9_]*$/;

// POST: 種別を追加。
export async function POST(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN");
  if (isAuthError(user)) return user;

  const body = await req.json().catch(() => ({}));
  const key = String(body.key ?? "").trim().toLowerCase();
  const label = String(body.label ?? "").trim();
  if (!KEY_RE.test(key)) {
    return NextResponse.json({ error: "キーは英小文字・数字・アンダースコアで、英字始まりにしてください。" }, { status: 400 });
  }
  if (!label) {
    return NextResponse.json({ error: "表示名は必須です。" }, { status: 400 });
  }

  const capability = normalizeCapability(body.capability);
  const usesOdometer = body.usesOdometer === true;
  const usesAmount = body.usesAmount === true;
  // 能力に必要なフィールドの整合性を担保する。
  const usesVehicle = body.usesVehicle !== false;
  if (capability === "oil_mileage" && !usesOdometer) {
    return NextResponse.json({ error: "「車両距離更新」には走行距離フィールドが必要です。" }, { status: 400 });
  }
  if (capability === "oil_mileage" && !usesVehicle) {
    return NextResponse.json({ error: "「車両距離更新」には車両の選択が必要です。" }, { status: 400 });
  }
  if (capability === "expense" && !usesAmount) {
    return NextResponse.json({ error: "「経費連携」には金額フィールドが必要です。" }, { status: 400 });
  }

  const row = {
    key,
    label,
    sort_order: Number.isFinite(Number(body.sortOrder)) ? Math.trunc(Number(body.sortOrder)) : 999,
    is_active: body.isActive !== false,
    uses_vehicle: usesVehicle,
    uses_location: body.usesLocation !== false,
    uses_odometer: usesOdometer,
    uses_description: body.usesDescription !== false,
    uses_amount: usesAmount,
    description_required: body.descriptionRequired !== false,
    description_label: typeof body.descriptionLabel === "string" && body.descriptionLabel.trim() ? body.descriptionLabel.trim() : null,
    capability,
  };

  const { data, error } = await supabase.from("report_kinds").insert(row).select("*").maybeSingle();
  if (error) {
    console.error("[admin/report-kinds] insert error", error);
    const dup = error.code === "23505";
    return NextResponse.json(
      { error: dup ? "そのキーは既に使われています。" : "保存に失敗しました（migration 068 未適用の可能性）。" },
      { status: dup ? 400 : 500 },
    );
  }
  return NextResponse.json({ kind: data });
}
