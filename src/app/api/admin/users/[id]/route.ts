import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

// PUT: ドライバー更新
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth(req, "ADMIN");
  if (isAuthError(user)) return user;

  try {
    const body = await req.json();
    const { name, officeCode, driverCode, courseIds, displayName, postalCode, address, phone, bankName, bankNo, bankHolder } = body;
    const { id: driverId } = await params;

    const updates: Record<string, unknown> = {};
    if (name) updates.name = name.trim();
    if (displayName !== undefined) {
      updates.display_name = typeof displayName === "string" && displayName.trim() ? displayName.trim() : null;
    }
    if (officeCode && /^\d{6}$/.test(officeCode)) {
      updates.office_code = officeCode;
    }
    if (driverCode) {
      updates.driver_code = driverCode.toUpperCase();
      // ドライバーコードの数字部分をPINとして更新
      const pinPart = driverCode.slice(3);
      if (/^\d{6}$/.test(pinPart)) {
        updates.pin_hash = await bcrypt.hash(pinPart, 10);
      }
    }
    if (postalCode !== undefined) updates.postal_code = typeof postalCode === "string" ? postalCode.trim() || null : null;
    if (address !== undefined) updates.address = typeof address === "string" ? address.trim() || null : null;
    if (phone !== undefined) updates.phone = typeof phone === "string" ? phone.trim() || null : null;
    if (bankName !== undefined) updates.bank_name = typeof bankName === "string" ? bankName.trim() || null : null;
    if (bankNo !== undefined) updates.bank_no = typeof bankNo === "string" ? bankNo.trim() || null : null;
    if (bankHolder !== undefined) updates.bank_holder = typeof bankHolder === "string" ? bankHolder.trim() || null : null;

    if (Object.keys(updates).length > 0) {
      const { error } = await supabase
        .from("drivers")
        .update(updates)
        .eq("id", driverId)
        .eq("company_code", user.companyCode); // 同じ会社のみ更新可能

      if (error) throw error;
    }

    // Update course associations
    if (Array.isArray(courseIds)) {
      // Remove existing
      await supabase.from("driver_courses").delete().eq("driver_id", driverId);

      // Add new
      if (courseIds.length > 0) {
        const courseLinks = courseIds.map((cid: string) => ({
          driver_id: driverId,
          course_id: cid,
        }));
        await supabase.from("driver_courses").insert(courseLinks);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE: ドライバー削除
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth(req, "ADMIN");
  if (isAuthError(user)) return user;

  const { id } = await params;

  // 同じ会社のドライバーのみ削除可能
  const { error } = await supabase
    .from("drivers")
    .delete()
    .eq("id", id)
    .eq("company_code", user.companyCode);

  if (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
