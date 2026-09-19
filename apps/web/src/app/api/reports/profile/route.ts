import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";
import { resolveIdentityId } from "@/server/identity";

export const dynamic = "force-dynamic";

const DRIVER_FIELDS =
  "name, office_code, driver_code, display_name, postal_code, address, phone, bank_name, bank_no, bank_holder";

/** ログイン中ドライバーのプロフィール（表示・配達受託者控オーバーレイ用） */
export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "DRIVER");
  if (isAuthError(user)) return user;

  // 互いに独立な取得は並列で（旧: 5段直列。submit と /me の基幹APIのため往復を削る）
  const [{ data: driver, error }, { data: identityRows }, identityId] = await Promise.all([
    // tenant-scope-ok: requireAuth由来の本人user.driverIdだけを参照・更新
    supabase.from("drivers").select(DRIVER_FIELDS).eq("id", user.driverId).single(),
    supabase
      .from("driver_identities")
      .select("id, slot, driver_code, office_code, label")
      .eq("driver_id", user.driverId)
      .order("slot", { ascending: true }),
    resolveIdentityId(user),
  ]);

  if (error || !driver) {
    return NextResponse.json({ error: "Driver not found" }, { status: 404 });
  }

  const identities = (identityRows ?? []).map((row: {
    id: string;
    slot: number;
    driver_code: string;
    office_code: string;
    label: string | null;
  }) => ({
    id: row.id,
    slot: row.slot,
    driverCode: row.driver_code,
    officeCode: row.office_code ?? "",
    label: row.label ?? "",
  }));

  const primary = identities[0];

  let phoneVerified = false;
  let hasPasskey = false;
  if (identityId) {
    const [{ data: identityRow }, { count }] = await Promise.all([
      supabase.from("identities").select("phone_verified_at").eq("id", identityId).maybeSingle(),
      supabase
        .from("passkey_credentials")
        .select("id", { count: "exact", head: true })
        .eq("identity_id", identityId),
    ]);
    phoneVerified = Boolean(identityRow?.phone_verified_at);
    hasPasskey = (count ?? 0) > 0;
  }

  return NextResponse.json({
    name: driver.name ?? "",
    officeCode: primary?.officeCode ?? driver.office_code ?? "",
    driverCode: primary?.driverCode ?? driver.driver_code ?? "",
    displayName: driver.display_name ?? "",
    postalCode: driver.postal_code ?? "",
    address: driver.address ?? "",
    phone: driver.phone ?? "",
    phoneVerified,
    hasPasskey,
    canChangePin: false,
    bankName: driver.bank_name ?? "",
    bankNo: driver.bank_no ?? "",
    bankHolder: driver.bank_holder ?? "",
    identities,
  });
}

/** 旧アプリからのPIN作成・変更も拒否する。 */
export async function PATCH(req: NextRequest) {
  const user = await requireAuth(req, "DRIVER");
  if (isAuthError(user)) return user;
  return NextResponse.json({ error: "PINの変更は終了しました。PasskeyまたはSMSでログインしてください", code: "PIN_LOGIN_RETIRED" }, { status: 410 });
}
