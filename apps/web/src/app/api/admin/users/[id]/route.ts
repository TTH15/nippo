import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { requireAuth, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

type IdentityInput = {
  slot: number;
  officeCode: string;
  driverNumber: string;
  label?: string;
  courseIds: string[];
};

// GET: ドライバー詳細（編集用）
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth(req, "ADMIN_OR_VIEWER");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);
  const { id: driverId } = await params;

  const { data: driver, error } = await supabase
    .from("drivers")
    .select(`
      id, name, display_name, role, company_code, office_code, driver_code, list_no, created_at, license_expiry_date,
      postal_code, address, phone, bank_name, bank_no, bank_holder,
      driver_identities (
        id, slot, driver_code, office_code, label,
        driver_courses (
          course_id,
          courses (id, name, color)
        )
      )
    `)
    .eq("id", driverId)
    .eq("org_id", orgId)
    .single();

  if (error || !driver) {
    return NextResponse.json({ error: "ドライバーが見つかりません" }, { status: 404 });
  }
  const response = NextResponse.json({ driver });
  response.headers.set("Cache-Control", "private, max-age=30, stale-while-revalidate=300");
  return response;
}

// PUT: ドライバー更新
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth(req, "ADMIN");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);

  try {
    const body = await req.json();
    const {
      name,
      officeCode,
      driverCode,
      courseIds,
      displayName,
      postalCode,
      address,
      phone,
      bankName,
      bankNo,
      bankHolder,
      licenseExpiryDate,
      status,
      identities: identitiesRaw,
    } = body;
    const { id: driverId } = await params;

    const { data: driverRow, error: driverFetchErr } = await supabase
      .from("drivers")
      .select("id, company_code, driver_code, pin_hash")
      .eq("id", driverId)
      .eq("org_id", orgId)
      .single();

    if (driverFetchErr || !driverRow) {
      return NextResponse.json({ error: "ドライバーが見つかりません" }, { status: 404 });
    }

    const companyCode = driverRow.company_code || user.companyCode;

    const updates: Record<string, unknown> = {};
    if (name) updates.name = name.trim();
    if (displayName !== undefined) {
      updates.display_name = typeof displayName === "string" && displayName.trim() ? displayName.trim() : null;
    }
    if (postalCode !== undefined) updates.postal_code = typeof postalCode === "string" ? postalCode.trim() || null : null;
    if (address !== undefined) updates.address = typeof address === "string" ? address.trim() || null : null;
    if (phone !== undefined) updates.phone = typeof phone === "string" ? phone.trim() || null : null;
    if (bankName !== undefined) updates.bank_name = typeof bankName === "string" ? bankName.trim() || null : null;
    if (bankNo !== undefined) updates.bank_no = typeof bankNo === "string" ? bankNo.trim() || null : null;
    if (bankHolder !== undefined) updates.bank_holder = typeof bankHolder === "string" ? bankHolder.trim() || null : null;
    if (licenseExpiryDate !== undefined) {
      updates.license_expiry_date =
        typeof licenseExpiryDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(licenseExpiryDate)
          ? licenseExpiryDate
          : null;
    }
    // Phase 7a: 参加申請の承認(active)/却下(rejected)。pending へは戻さない。
    if (status === "active" || status === "rejected") {
      updates.status = status;
    }

    const syncSlot1ToDriver = async (fullCode: string, office: string) => {
      const { data: d } = await supabase
        .from("drivers")
        .select("driver_code, pin_hash")
        .eq("id", driverId)
        .single();

      const newPinPart = fullCode.slice(3);
      if (d?.driver_code && d?.pin_hash) {
        const oldPinPart = d.driver_code.slice(3);
        const stillUsingInitialPin = await bcrypt.compare(oldPinPart, d.pin_hash);
        if (stillUsingInitialPin && fullCode !== d.driver_code.toUpperCase()) {
          await supabase
            .from("drivers")
            .update({
              driver_code: fullCode,
              office_code: office,
              pin_hash: await bcrypt.hash(newPinPart, 10),
            })
            .eq("id", driverId);
          return;
        }
      }
      // Phase 7a: pin_hash 未設定（参加申請の承認で初めて driver_code を割り当てる）なら
      // 初期PIN（コードの数字6桁）を発行する。既存PIN（カスタム含む）があるときは触らない。
      const finalUpdate: Record<string, unknown> = { driver_code: fullCode, office_code: office };
      if (!d?.pin_hash) {
        finalUpdate.pin_hash = await bcrypt.hash(newPinPart, 10);
      }
      await supabase.from("drivers").update(finalUpdate).eq("id", driverId).eq("org_id", orgId);
    };

    const upsertIdentity = async (item: IdentityInput) => {
      const slot = item.slot === 2 ? 2 : 1;
      const office = typeof item.officeCode === "string" ? item.officeCode.trim() : "";
      const num = typeof item.driverNumber === "string" ? item.driverNumber.replace(/\D/g, "") : "";
      const courseList = Array.isArray(item.courseIds) ? item.courseIds : [];

      if (slot === 2 && (!num || num.length !== 6)) {
        const { data: ex2 } = await supabase
          .from("driver_identities")
          .select("id")
          .eq("driver_id", driverId)
          .eq("slot", 2)
          .maybeSingle();
        if (ex2?.id) {
          await supabase.from("driver_identities").delete().eq("id", ex2.id);
        }
        return null;
      }

      if (!/^\d{6}$/.test(office)) {
        return NextResponse.json({ error: `勤務区分${slot}の事業所コードは6桁で入力してください` }, { status: 400 });
      }
      if (num.length !== 6 || !/^\d{6}$/.test(num)) {
        return NextResponse.json({ error: `勤務区分${slot}のドライバー番号は6桁の数字で入力してください` }, { status: 400 });
      }

      const fullCode = `${companyCode}${num}`.toUpperCase();
      if (fullCode.slice(0, 3) !== companyCode) {
        return NextResponse.json({ error: "会社コードが一致しません" }, { status: 400 });
      }

      const label =
        typeof item.label === "string" && item.label.trim() ? item.label.trim() : null;

      const { data: existing } = await supabase
        .from("driver_identities")
        .select("id")
        .eq("driver_id", driverId)
        .eq("slot", slot)
        .maybeSingle();

      let identityId: string;

      if (existing) {
        const { error: uErr } = await supabase
          .from("driver_identities")
          .update({
            driver_code: fullCode,
            office_code: office,
            label,
          })
          .eq("id", existing.id);
        if (uErr) throw uErr;
        identityId = existing.id;
      } else {
        const { data: ins, error: iErr } = await supabase
          .from("driver_identities")
          .insert({
            driver_id: driverId,
            slot,
            driver_code: fullCode,
            office_code: office,
            label,
          })
          .select("id")
          .single();
        if (iErr) throw iErr;
        identityId = ins!.id;
      }

      await supabase.from("driver_courses").delete().eq("driver_identity_id", identityId);
      if (courseList.length > 0) {
        const { error: cErr } = await supabase.from("driver_courses").insert(
          courseList.map((cid: string) => ({
            driver_id: driverId,
            driver_identity_id: identityId,
            course_id: cid,
          })),
        );
        if (cErr) throw cErr;
      }

      if (slot === 1) {
        await syncSlot1ToDriver(fullCode, office);
      }

      return null;
    };

    if (Array.isArray(identitiesRaw) && identitiesRaw.length > 0) {
      const normalized: IdentityInput[] = identitiesRaw.map((x: IdentityInput) => ({
        slot: x.slot === 2 ? 2 : 1,
        officeCode: x.officeCode ?? "",
        driverNumber: x.driverNumber ?? "",
        label: x.label,
        courseIds: x.courseIds ?? [],
      }));
      for (const item of normalized) {
        const errRes = await upsertIdentity(item);
        if (errRes) return errRes;
      }
    } else if (driverCode && officeCode && Array.isArray(courseIds)) {
      const full = String(driverCode).toUpperCase();
      const num = full.slice(3);
      const errRes = await upsertIdentity({
        slot: 1,
        officeCode: String(officeCode),
        driverNumber: num,
        courseIds,
      });
      if (errRes) return errRes;
    }

    if (Object.keys(updates).length > 0) {
      const { error } = await supabase.from("drivers").update(updates).eq("id", driverId).eq("org_id", orgId);
      if (error) throw error;
    }

    const { data: slot1 } = await supabase
      .from("driver_identities")
      .select("driver_code, office_code")
      .eq("driver_id", driverId)
      .eq("slot", 1)
      .maybeSingle();
    if (slot1) {
      await supabase
        .from("drivers")
        .update({
          driver_code: slot1.driver_code,
          office_code: slot1.office_code,
        })
        .eq("id", driverId);
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
  const orgId = await resolveOrgId(user.driverId);

  const { id } = await params;

  const { error } = await supabase
    .from("drivers")
    .delete()
    .eq("id", id)
    .eq("org_id", orgId);

  if (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
