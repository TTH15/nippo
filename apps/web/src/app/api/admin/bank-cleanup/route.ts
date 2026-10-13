import { NextRequest, NextResponse } from "next/server";
import { requirePermission, hasCapabilityCached, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { bankCleanupRow, bankStorageFields, sameBankStorage, type BankCleanupDriver, type BankCleanupRow } from "@/lib/bankCleanup";
export const dynamic = "force-dynamic";
const columns = `id,name,driver_code,${bankStorageFields.join(",")}`;
async function authorize(req: NextRequest, write = false) {
  const user = await requirePermission(req, write ? "can_manage_members" : "can_view_members");
  if (isAuthError(user)) return user;
  if (!await hasCapabilityCached(user, "can_view_bank_accounts") || !await hasCapabilityCached(user, "can_view_members")) return NextResponse.json({ error: "口座情報を確認する権限がありません" }, { status: 403 });
  return { orgId: await resolveOrgId(user.driverId) };
}
export async function GET(req: NextRequest) {
  const auth = await authorize(req); if (auth instanceof NextResponse) return auth;
  const raw = Number(req.nextUrl.searchParams.get("cursor") ?? 0);
  const cursor = Number.isSafeInteger(raw) && raw >= 0 ? raw : 0;
  const { data, error } = await supabase.from("drivers").select(columns).eq("org_id", auth.orgId).eq("works_as_driver", true).order("id").range(cursor, cursor + 99);
  if (error) return NextResponse.json({ error: "口座情報を取得できませんでした" }, { status: 500 });
  const rows = (data as unknown as BankCleanupDriver[]).map(bankCleanupRow).filter((row): row is BankCleanupRow => row !== null);
  return NextResponse.json({ rows, nextCursor: data.length === 100 ? cursor + 100 : null }, { headers: { "Cache-Control": "no-store" } });
}
export async function POST(req: NextRequest) {
  const auth = await authorize(req, true); if (auth instanceof NextResponse) return auth;
  let body; try { body = await req.json(); } catch { return NextResponse.json({ error: "確認内容を読み込み直してください" }, { status: 400 }); }
  if (!body || typeof body.id !== "string" || !body.before || !body.candidate || !bankStorageFields.every(key => Object.hasOwn(body.before, key) && (body.before[key] === null || typeof body.before[key] === "string") && Object.hasOwn(body.candidate, key) && (body.candidate[key] === null || typeof body.candidate[key] === "string"))) return NextResponse.json({ error: "確認内容を読み込み直してください" }, { status: 400 });
  const { data, error } = await supabase.from("drivers").select(columns).eq("org_id", auth.orgId).eq("works_as_driver", true).eq("id", body.id).maybeSingle();
  if (error) return NextResponse.json({ error: "口座情報を取得できませんでした" }, { status: 500 });
  if (!data) return NextResponse.json({ error: "対象のドライバーが見つかりません" }, { status: 404 });
  const driver = data as unknown as BankCleanupDriver;
  const row = bankCleanupRow(driver);
  if (!sameBankStorage(driver, body.before) || !row?.candidate || !sameBankStorage(row.candidate, body.candidate)) return NextResponse.json({ error: "口座情報が変わっています。再読み込みして確認してください" }, { status: 409 });
  let update = supabase.from("drivers").update(row.candidate).eq("org_id", auth.orgId).eq("works_as_driver", true).eq("id", body.id);
  for (const key of bankStorageFields) update = driver[key] == null ? update.is(key, null) : update.eq(key, driver[key]!);
  const result = await update.select("id").maybeSingle();
  if (result.error) return NextResponse.json({ error: "保存できませんでした。再試行してください" }, { status: 500 });
  if (!result.data) return NextResponse.json({ error: "口座情報が変わっています。再読み込みして確認してください" }, { status: 409 });
  return NextResponse.json({ ok: true });
}
