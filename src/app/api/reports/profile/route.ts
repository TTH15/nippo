import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

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

  return NextResponse.json({
    name: driver.name ?? "",
    officeCode: driver.office_code ?? "",
    driverCode: driver.driver_code ?? "",
    displayName: driver.display_name ?? "",
    postalCode: driver.postal_code ?? "",
    address: driver.address ?? "",
    phone: driver.phone ?? "",
    bankName: driver.bank_name ?? "",
    bankNo: driver.bank_no ?? "",
    bankHolder: driver.bank_holder ?? "",
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
