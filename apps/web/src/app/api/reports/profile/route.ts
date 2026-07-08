import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
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

  const { data: driver, error } = await supabase
    .from("drivers")
    .select(DRIVER_FIELDS)
    .eq("id", user.driverId)
    .single();

  if (error || !driver) {
    return NextResponse.json({ error: "Driver not found" }, { status: 404 });
  }

  const { data: identityRows } = await supabase
    .from("driver_identities")
    .select("id, slot, driver_code, office_code, label")
    .eq("driver_id", user.driverId)
    .order("slot", { ascending: true });

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

  const identityId = await resolveIdentityId(user);
  let phoneVerified = false;
  if (identityId) {
    const { data: identityRow } = await supabase
      .from("identities")
      .select("phone_verified_at")
      .eq("id", identityId)
      .maybeSingle();
    phoneVerified = Boolean(identityRow?.phone_verified_at);
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
    bankName: driver.bank_name ?? "",
    bankNo: driver.bank_no ?? "",
    bankHolder: driver.bank_holder ?? "",
    identities,
  });
}

/** PIN変更（ログイン中であれば変更可能） */
export async function PATCH(req: NextRequest) {
  const user = await requireAuth(req, "DRIVER");
  if (isAuthError(user)) return user;

  let body: { newPin?: string; confirmPin?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { newPin, confirmPin } = body;
  if (!newPin || typeof newPin !== "string" || newPin.length !== 6 || !/^\d{6}$/.test(newPin)) {
    return NextResponse.json(
      { error: "新しいPINは6桁の数字で入力してください" },
      { status: 400 },
    );
  }
  if (newPin !== confirmPin) {
    return NextResponse.json(
      { error: "新しいPINと確認用が一致しません" },
      { status: 400 },
    );
  }

  const pinHash = await bcrypt.hash(newPin, 10);
  const { error } = await supabase
    .from("drivers")
    .update({ pin_hash: pinHash })
    .eq("id", user.driverId);

  if (error) {
    console.error("[Profile PATCH] Update pin_hash error:", error);
    return NextResponse.json({ error: "PINの更新に失敗しました" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
