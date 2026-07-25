import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { requirePermission, isAuthError, getCapabilities } from "@/server/auth";
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
  const user = await requirePermission(req, "can_view_members");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);
  const { id: driverId } = await params;

  const { data: driver, error } = await supabase
    .from("drivers")
    .select(`
      id, name, display_name, role, role_id, identity_id, company_code, office_code, driver_code, list_no, created_at, license_expiry_date,
      postal_code, address, phone, bank_name, bank_no, bank_holder, status, active_from_month, active_until_month,
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
  // §2-6: 口座情報は can_view_bank_accounts を持つ場合のみ開示（名簿閲覧だけでは見せない）。
  const caps = await getCapabilities(user);
  if (!caps.has("can_view_bank_accounts")) {
    driver.bank_name = null;
    driver.bank_no = null;
    driver.bank_holder = null;
  }
  // 電話番号が Twilio(SMS OTP) で認証済みか（identities.phone_verified_at・仮登録で刻まれる）。
  let phoneVerifiedAt: string | null = null;
  let hasPasskey = false;
  const identId = (driver as { identity_id?: string | null }).identity_id;
  if (identId) {
    const { data: idn } = await supabase
      .from("identities")
      .select("phone_verified_at")
      .eq("id", identId)
      .maybeSingle();
    phoneVerifiedAt = (idn?.phone_verified_at as string | null) ?? null;

    const { count } = await supabase
      .from("passkey_credentials")
      .select("id", { count: "exact", head: true })
      .eq("identity_id", identId);
    hasPasskey = (count ?? 0) > 0;
  }
  (driver as Record<string, unknown>).phone_verified_at = phoneVerifiedAt;
  (driver as Record<string, unknown>).has_passkey = hasPasskey;

  const response = NextResponse.json({ driver });
  response.headers.set("Cache-Control", "private, max-age=30, stale-while-revalidate=300");
  return response;
}

// PUT: ドライバー更新
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requirePermission(req, "can_manage_members");
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
      activeFromMonth,
      activeUntilMonth,
      roleId,
      worksAsDriver,
      identities: identitiesRaw,
    } = body;
    const { id: driverId } = await params;

    const { data: driverRow, error: driverFetchErr } = await supabase
      .from("drivers")
      .select("id, company_code, driver_code, pin_hash, role, role_id, status, phone, identity_id")
      .eq("id", driverId)
      .eq("org_id", orgId)
      .single();

    if (driverFetchErr || !driverRow) {
      return NextResponse.json({ error: "ドライバーが見つかりません" }, { status: 404 });
    }

    // ガバナンス保護: org には常に active な管理者(ADMIN)が1人以上必要。
    // 最後の ADMIN を別ロールに変更/却下しようとしたら弾く（ロックアウト防止）。
    const { data: adminRole } = await supabase
      .from("roles")
      .select("id")
      .eq("org_id", orgId)
      .eq("key", "ADMIN")
      .maybeSingle();
    const isCurrentlyAdmin = !!adminRole && driverRow.role_id === adminRole.id;
    const willLeaveAdmin =
      isCurrentlyAdmin &&
      ((roleId !== undefined && roleId !== null && roleId !== adminRole!.id) ||
        status === "rejected" ||
        status === "inactive");
    if (willLeaveAdmin) {
      const { count } = await supabase
        .from("drivers")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .eq("role_id", adminRole!.id)
        .eq("status", "active")
        .neq("id", driverId);
      if ((count ?? 0) === 0) {
        return NextResponse.json(
          { error: "最後の管理者です。先に別のメンバーを管理者に設定してください" },
          { status: 400 },
        );
      }
    }

    const companyCode = driverRow.company_code || user.companyCode;

    const updates: Record<string, unknown> = {};
    if (name) updates.name = name.trim();
    if (displayName !== undefined) {
      updates.display_name = typeof displayName === "string" && displayName.trim() ? displayName.trim() : null;
    }
    if (postalCode !== undefined) updates.postal_code = typeof postalCode === "string" ? postalCode.trim() || null : null;
    if (address !== undefined) updates.address = typeof address === "string" ? address.trim() || null : null;
    if (phone !== undefined) {
      const nextPhone = typeof phone === "string" ? phone.trim() || null : null;
      if (nextPhone !== driverRow.phone && driverRow.identity_id) {
        const { data: idn } = await supabase
          .from("identities")
          .select("phone_verified_at")
          .eq("id", driverRow.identity_id)
          .maybeSingle();
        if (idn?.phone_verified_at) {
          return NextResponse.json(
            { error: "認証済みの電話番号は運営画面から変更できません。ドライバー本人にマイページでの再確認をご案内ください" },
            { status: 400 },
          );
        }
      }
      updates.phone = nextPhone;
    }
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
    // inactive（稼働終了）は誤操作防止のため、担当コースが1件でも残っていると弾く
    // （先にコース割り当てを全解除してもらう）。
    if (status === "inactive" && driverRow.status !== "inactive") {
      const { count: assignedCourseCount } = await supabase
        .from("driver_courses")
        .select("id", { count: "exact", head: true })
        .eq("driver_id", driverId);
      if ((assignedCourseCount ?? 0) > 0) {
        return NextResponse.json(
          { error: "担当コースが割り当てられたままです。先にコースの割り当てをすべて解除してください" },
          { status: 400 },
        );
      }
    }
    if (status === "active" || status === "rejected" || status === "inactive") {
      updates.status = status;
    }
    if (activeFromMonth !== undefined) {
      updates.active_from_month =
        typeof activeFromMonth === "string" && /^\d{4}-\d{2}$/.test(activeFromMonth) ? activeFromMonth : null;
    }
    if (activeUntilMonth !== undefined) {
      updates.active_until_month =
        typeof activeUntilMonth === "string" && /^\d{4}-\d{2}$/.test(activeUntilMonth) ? activeUntilMonth : null;
    }
    // §2-6: ロール割当（role_id を正本に、role テキストも key で同期＝表示・互換）。
    // 当 org のロールのみ受け付ける（他社ロールは弾く）。
    if (roleId !== undefined && roleId !== null) {
      const { data: role } = await supabase
        .from("roles")
        .select("id, key, works_as_driver")
        .eq("id", roleId)
        .eq("org_id", orgId)
        .maybeSingle();
      if (!role) {
        return NextResponse.json({ error: "指定されたロールが見つかりません" }, { status: 400 });
      }
      updates.role_id = role.id;
      updates.role = role.key;
      // 「ドライバーとして扱う」の正本はドライバー個人（drivers.works_as_driver）。
      // ロール側の値は割当時の既定値としてのみ使い、ON への引き上げだけ行う
      //（管理者へ昇格しても個人のドライバー稼働設定は失われない。DRIVER ロール割当は必ず ON）。
      if (role.works_as_driver === true) {
        updates.works_as_driver = true;
      }
    }
    // 個人単位の「ドライバーとして扱う」設定。DRIVER ロールのメンバーは常に ON
    //（OFF にするとシフト・名簿から消えるため固定）。
    if (typeof worksAsDriver === "boolean") {
      const effectiveRoleKey = typeof updates.role === "string" ? updates.role : driverRow.role;
      if (effectiveRoleKey === "DRIVER" && !worksAsDriver) {
        return NextResponse.json(
          { error: "ドライバーロールのメンバーは常にドライバーとして扱われます" },
          { status: 400 },
        );
      }
      updates.works_as_driver = worksAsDriver;
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
      // PIN撤廃（§2-1a）: 承認で driver_code を割り当てても初期PINは発行しない。
      // 仮承認で入った新規ドライバーは PINレス＝電話OTP でログイン→Passkey 登録する。
      // 既存PIN（手動作成・カスタム含む）を持つドライバーは上の分岐で処理済みで、ここでは pin_hash を触らない。
      await supabase
        .from("drivers")
        .update({ driver_code: fullCode, office_code: office })
        .eq("id", driverId)
        .eq("org_id", orgId);
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
  const user = await requirePermission(req, "can_manage_members");
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
