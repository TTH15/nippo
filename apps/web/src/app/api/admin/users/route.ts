import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { requireAuth, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

// GET: 全ドライバー一覧（コース情報含む）
export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN_OR_VIEWER");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);
  const url = req.nextUrl;
  const limitRaw = Number(url.searchParams.get("limit") || "20");
  const cursorRaw = Number(url.searchParams.get("cursor") || "0");
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.floor(limitRaw))) : 20;
  const offset = Number.isFinite(cursorRaw) ? Math.max(0, Math.floor(cursorRaw)) : 0;
  // Phase 7a: status フィルタ。既定は active（既存ロスター挙動を維持）。?status=pending で承認待ち一覧。
  const statusRaw = url.searchParams.get("status");
  const status = statusRaw && ["pending", "active", "rejected"].includes(statusRaw) ? statusRaw : "active";

  // 同じ会社コードのドライバー一覧（一覧表示に不要な住所/口座情報は除外）
  const { data: drivers, error } = await supabase
    .from("drivers")
    .select(`
      id, name, display_name, role, office_code, driver_code, list_no, license_expiry_date, status, created_at,
      postal_code, address, phone, bank_name, bank_no, bank_holder,
      driver_identities (
        id, slot, driver_code, office_code, label,
        driver_courses (
          course_id,
          courses (id, name, color)
        )
      )
    `)
    .eq("org_id", orgId)
    .eq("role", "DRIVER")
    .eq("status", status)
    .order("list_no", { ascending: true, nullsFirst: false })
    .order("name", { ascending: true })
    .order("id", { ascending: true })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error(error);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  const countRes = await supabase
    .from("drivers")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("role", "DRIVER")
    .eq("status", status);
  const total = countRes.count ?? 0;
  const nextCursor = offset + (drivers?.length ?? 0) < total ? String(offset + (drivers?.length ?? 0)) : null;

  // プライバシー: 承認前（pending）の申請者の電話は下4桁のみ開示（サーバ側マスク）。
  // 誤 join_code で別 org に出てもフル電話は渡さない。active は所属ドライバーなのでフル。
  const rows =
    status === "pending"
      ? (drivers ?? []).map((d) => {
          const p = (d as { phone?: string | null }).phone;
          const digits = typeof p === "string" ? p.replace(/\D/g, "") : "";
          return { ...d, phone: digits ? `***${digits.slice(-4)}` : null };
        })
      : (drivers ?? []);

  const response = NextResponse.json({
    drivers: rows,
    nextCursor,
    hasMore: nextCursor != null,
    total,
  });
  response.headers.set("Cache-Control", "private, max-age=60, stale-while-revalidate=600");
  return response;
}

// POST: 新規ドライバー追加
export async function POST(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);

  try {
    const body = await req.json();
    const {
      name,
      officeCode,
      driverCode,
      companyCode,
      courseIds = [],
      displayName,
      officeCode2,
      driverNumber2,
      courseIds2 = [],
      licenseExpiryDate,
    } = body as {
      name?: string;
      officeCode?: string;
      driverCode?: string;
      companyCode?: string;
      courseIds?: string[];
      displayName?: string;
      postalCode?: string;
      address?: string;
      phone?: string;
      bankName?: string;
      bankNo?: string;
      bankHolder?: string;
      officeCode2?: string;
      driverNumber2?: string;
      courseIds2?: string[];
      licenseExpiryDate?: string | null;
    };

    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "名前を入力してください" }, { status: 400 });
    }
    if (!officeCode || !/^\d{6}$/.test(officeCode)) {
      return NextResponse.json({ error: "事業所コードは6桁の数字で入力してください" }, { status: 400 });
    }
    if (!driverCode || !/^[A-Z]{3}\d{6}$/.test(driverCode)) {
      return NextResponse.json({ error: "ドライバーコードの形式が正しくありません" }, { status: 400 });
    }

    const resolvedCompany = (companyCode || user.companyCode) as string;

    // ドライバーコードの会社部分が管理者の会社と一致するか確認
    const codeCompany = driverCode.slice(0, 3);
    if (codeCompany !== resolvedCompany) {
      return NextResponse.json({ error: "会社コードが一致しません" }, { status: 400 });
    }

    // ドライバーコードの数字部分をPINとしてハッシュ化
    const pinPart = driverCode.slice(3);
    const pinHash = await bcrypt.hash(pinPart, 10);

    const { data: listRows } = await supabase
      .from("drivers")
      .select("list_no")
      .eq("org_id", orgId)
      .eq("role", "DRIVER");

    const maxNo = Math.max(
      0,
      ...((listRows ?? []) as { list_no: number | null }[]).map((r) =>
        typeof r.list_no === "number" ? r.list_no : 0,
      ),
    );
    const nextListNo = maxNo + 1;

    // Insert driver
    const { postalCode, address, phone, bankName, bankNo, bankHolder } = body;
    const { data: driver, error: dErr } = await supabase
      .from("drivers")
      .insert({
        org_id: orgId,
        name: name.trim(),
        display_name: typeof displayName === "string" && displayName.trim() ? displayName.trim() : null,
        role: "DRIVER",
        pin_hash: pinHash,
        company_code: resolvedCompany,
        office_code: officeCode,
        driver_code: driverCode.toUpperCase(),
        list_no: nextListNo,
        postal_code: typeof postalCode === "string" ? postalCode.trim() || null : null,
        address: typeof address === "string" ? address.trim() || null : null,
        phone: typeof phone === "string" ? phone.trim() || null : null,
        bank_name: typeof bankName === "string" ? bankName.trim() || null : null,
        bank_no: typeof bankNo === "string" ? bankNo.trim() || null : null,
        bank_holder: typeof bankHolder === "string" ? bankHolder.trim() || null : null,
        license_expiry_date:
          typeof licenseExpiryDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(licenseExpiryDate)
            ? licenseExpiryDate
            : null,
      })
      .select()
      .single();

    if (dErr) {
      console.error(dErr);
      if (dErr.code === "23505") {
        return NextResponse.json({ error: "このドライバーコードは既に使用されています" }, { status: 400 });
      }
      return NextResponse.json({ error: dErr.message }, { status: 500 });
    }

    // identity 層（人単位）。driver=membership は必ず 1 つの identity を持つ（Phase 5a）。
    // 氏名・電話・免許・PIN を人単位の属性として刻む（読み替えは Phase 6）。
    const { data: identity, error: identErr } = await supabase
      .from("identities")
      .insert({
        name: name.trim(),
        phone: typeof phone === "string" ? phone.trim() || null : null,
        license_expiry:
          typeof licenseExpiryDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(licenseExpiryDate)
            ? licenseExpiryDate
            : null,
        pin_hash: pinHash,
      })
      .select("id")
      .single();
    if (identErr || !identity) {
      console.error(identErr);
      return NextResponse.json({ error: "アイデンティティの作成に失敗しました" }, { status: 500 });
    }
    await supabase.from("drivers").update({ identity_id: identity.id }).eq("id", driver.id);

    const { data: ident1, error: iErr } = await supabase
      .from("driver_identities")
      .insert({
        driver_id: driver.id,
        slot: 1,
        driver_code: driverCode.toUpperCase(),
        office_code: officeCode,
      })
      .select("id")
      .single();

    if (iErr || !ident1) {
      console.error(iErr);
      return NextResponse.json({ error: "勤務区分の作成に失敗しました" }, { status: 500 });
    }

    if (courseIds.length > 0) {
      const courseLinks = courseIds.map((cid: string) => ({
        driver_id: driver.id,
        driver_identity_id: ident1.id,
        course_id: cid,
      }));
      await supabase.from("driver_courses").insert(courseLinks);
    }

    const oc2 = typeof officeCode2 === "string" ? officeCode2.replace(/\D/g, "") : "";
    const num2 = typeof driverNumber2 === "string" ? driverNumber2.replace(/\D/g, "") : "";
    if (oc2.length === 6 && num2.length === 6 && /^\d{6}$/.test(oc2) && /^\d{6}$/.test(num2)) {
      const full2 = `${resolvedCompany}${num2}`.toUpperCase();
      if (full2.slice(0, 3) === resolvedCompany) {
        const { data: ident2, error: e2 } = await supabase
          .from("driver_identities")
          .insert({
            driver_id: driver.id,
            slot: 2,
            driver_code: full2,
            office_code: oc2,
          })
          .select("id")
          .single();
        if (!e2 && ident2 && Array.isArray(courseIds2) && courseIds2.length > 0) {
          await supabase.from("driver_courses").insert(
            courseIds2.map((cid: string) => ({
              driver_id: driver.id,
              driver_identity_id: ident2.id,
              course_id: cid,
            })),
          );
        }
      }
    }

    return NextResponse.json({ driver });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
