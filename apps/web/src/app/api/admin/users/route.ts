import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { toE164JP } from "@/server/otp/phone";
import { signKyc } from "@/server/kyc/storage";

export const dynamic = "force-dynamic";

// GET: 全ドライバー一覧（コース情報含む）
export async function GET(req: NextRequest) {
  const user = await requirePermission(req, "can_view_members");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);
  const url = req.nextUrl;
  const limitRaw = Number(url.searchParams.get("limit") || "20");
  const cursorRaw = Number(url.searchParams.get("cursor") || "0");
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.floor(limitRaw))) : 20;
  const offset = Number.isFinite(cursorRaw) ? Math.max(0, Math.floor(cursorRaw)) : 0;
  // Phase 7a: status フィルタ。既定は active（既存ロスター挙動を維持）。?status=pending で承認待ち一覧。
  // status=all は「active または inactive」（請求書のドライバー選択など、稼働終了済みも
  // 選べる必要がある画面向け。pending/rejected はメンバーではないため対象外）。
  const statusRaw = url.searchParams.get("status");
  const status =
    statusRaw && ["pending", "active", "rejected", "inactive", "all"].includes(statusRaw) ? statusRaw : "active";
  const statusIn = status === "all" ? ["active", "inactive"] : [status];
  // 過去の年月時点で在籍していたドライバーを絞り込む（請求書一覧の年月フォルダ等で使用）。
  // 指定時は status フィルタを無視し、稼働期間(active_from_month〜active_until_month)が
  // その年月を含むドライバーを active/inactive 問わず返す（過去は在籍済みで判定するため）。
  const activeMonthRaw = url.searchParams.get("activeMonth");
  const activeMonth = activeMonthRaw && /^\d{4}-\d{2}$/.test(activeMonthRaw) ? activeMonthRaw : null;

  // 2段階承認: stage=kyc → 本人確認(本承認)待ち。
  // active＋kyc_verified_at NULL＋本登録提出済(identities.license_photo_path あり)。
  if (url.searchParams.get("stage") === "kyc") {
    const { data, error: kErr } = await supabase
      .from("drivers")
      .select("id, name, phone, created_at, identities ( license_photo_path, name_kana )")
      .eq("org_id", orgId)
      .eq("works_as_driver", true)
      .eq("status", "active")
      .is("kyc_verified_at", null)
      .order("created_at", { ascending: true });
    if (kErr) {
      console.error(kErr);
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }
    const rows = (data ?? [])
      .filter((d) => {
        const id = (d as { identities?: { license_photo_path?: string | null } | null }).identities;
        return !!id?.license_photo_path; // 本登録の免許写真を提出済のみ
      })
      .map((d) => {
        const id = (d as { identities?: { name_kana?: string | null } | null }).identities;
        return { id: d.id, name: d.name, nameKana: id?.name_kana ?? "", created_at: d.created_at };
      });
    return NextResponse.json({ drivers: rows, total: rows.length });
  }

  // all=1: ページングなしで全ドライバーを返す（車両のドライバー選択など、セレクタ用途）。
  // 顔写真の署名はしない（一覧表示専用の重い処理を避ける）。
  if (url.searchParams.get("all") === "1") {
    let allQuery = supabase
      .from("drivers")
      .select(`
        id, name, display_name, role, office_code, driver_code, list_no, status, active_from_month, active_until_month,
        driver_identities (
          id, slot, driver_code, office_code, label,
          driver_courses ( course_id, courses (id, name, color) )
        )
      `)
      .eq("org_id", orgId)
      .eq("works_as_driver", true);
    if (activeMonth) {
      allQuery = allQuery
        .or(`active_from_month.is.null,active_from_month.lte.${activeMonth}`)
        .or(`active_until_month.is.null,active_until_month.gte.${activeMonth}`);
    } else {
      allQuery = allQuery.in("status", statusIn);
    }
    const { data: allRows, error: allErr } = await allQuery
      .order("list_no", { ascending: true, nullsFirst: false })
      .order("name", { ascending: true })
      .order("id", { ascending: true });
    if (allErr) {
      console.error(allErr);
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }
    return NextResponse.json({ drivers: allRows ?? [], total: (allRows ?? []).length });
  }

  // 同じ会社コードのドライバー一覧（一覧表示に不要な住所/口座情報は除外）
  const { data: drivers, error } = await supabase
    .from("drivers")
    .select(`
      id, name, display_name, role, role_id, identity_id, office_code, driver_code, list_no, license_expiry_date, status, active_from_month, active_until_month, created_at,
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
    .eq("works_as_driver", true)
    .in("status", statusIn)
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
    .eq("works_as_driver", true)
    .in("status", statusIn);
  const total = countRes.count ?? 0;
  const returned = drivers?.length ?? 0;
  // ページが limit 未満＝最終ページ。total(件数)が実データとズレても空ページを無限に
  // 要求しないよう、len<limit で必ず終了させる。
  const nextCursor = returned === limit && offset + returned < total ? String(offset + returned) : null;

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

  // 顔写真（identities.face_photo_path・非公開バケット）を署名URL化してアバター表示に使う。
  const identityIds = Array.from(
    new Set((rows as { identity_id?: string | null }[]).map((r) => r.identity_id).filter(Boolean)),
  ) as string[];
  const faceByIdentity = new Map<string, string>();
  // 承認画面用: 本登録（KYC）の提出状況。pending 行にだけ付与する（§2-1a 承認1回統合）。
  const kycByIdentity = new Map<string, { hasLicensePhoto: boolean; hasFacePhoto: boolean; hasLicenseExpiry: boolean }>();
  // 承認待ち一覧の副題に出すフリガナ（同姓の識別に電話マスクより役立つ・2026-08-03）。
  const kanaByIdentity = new Map<string, string>();
  if (identityIds.length > 0) {
    const { data: idRows } = await supabase
      .from("identities")
      .select("id, face_photo_path, license_photo_path, license_expiry, name_kana")
      .in("id", identityIds);
    await Promise.all(
      (idRows ?? []).map(
        async (ir: {
          id: string;
          face_photo_path: string | null;
          license_photo_path: string | null;
          license_expiry: string | null;
          name_kana: string | null;
        }) => {
          kycByIdentity.set(ir.id, {
            hasLicensePhoto: !!ir.license_photo_path,
            hasFacePhoto: !!ir.face_photo_path,
            hasLicenseExpiry: !!ir.license_expiry,
          });
          if (ir.name_kana) kanaByIdentity.set(ir.id, ir.name_kana);
          if (!ir.face_photo_path) return;
          const signed = await signKyc(supabase, ir.face_photo_path);
          if (signed) faceByIdentity.set(ir.id, signed);
        },
      ),
    );
  }
  const rowsWithFace = (rows as ({ identity_id?: string | null } & Record<string, unknown>)[]).map(
    (r) => {
      const base = { ...r, faceUrl: r.identity_id ? faceByIdentity.get(r.identity_id) ?? null : null };
      if (status !== "pending") return base;
      const kyc = r.identity_id ? kycByIdentity.get(r.identity_id) : undefined;
      const hasLicensePhoto = kyc?.hasLicensePhoto ?? false;
      const hasFacePhoto = kyc?.hasFacePhoto ?? false;
      // サーバの本登録 complete 条件（me/registration）と同じ基準（口座は完了条件外・2026-07-25）。
      const kycComplete =
        hasLicensePhoto &&
        hasFacePhoto &&
        (kyc?.hasLicenseExpiry ?? false) &&
        !!r.postal_code &&
        !!r.address;
      const nameKana = r.identity_id ? (kanaByIdentity.get(r.identity_id) ?? "") : "";
      return { ...base, hasLicensePhoto, hasFacePhoto, kycComplete, nameKana };
    },
  );

  const response = NextResponse.json({
    drivers: rowsWithFace,
    nextCursor,
    hasMore: nextCursor != null,
    total,
  });
  response.headers.set("Cache-Control", "private, max-age=60, stale-while-revalidate=600");
  return response;
}

// POST: 新規ドライバー追加
export async function POST(req: NextRequest) {
  const user = await requirePermission(req, "can_manage_members");
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

    // 勤務区分(driver_identities.driver_code)はグローバル一意。drivers を作る前に
    // 衝突を検査し、孤児行を残さず明確なエラーを返す（後続の driver_identities 挿入が
    // 失敗してもこの POST はトランザクションではないため、ここで弾くのが安全）。
    const code1 = driverCode.toUpperCase();
    const oc2pre = typeof officeCode2 === "string" ? officeCode2.replace(/\D/g, "") : "";
    const num2pre = typeof driverNumber2 === "string" ? driverNumber2.replace(/\D/g, "") : "";
    const code2 =
      oc2pre.length === 6 && num2pre.length === 6 ? `${resolvedCompany}${num2pre}`.toUpperCase() : null;
    const codesToCheck = code2 ? [code1, code2] : [code1];
    const { data: dupCodes, error: dupErr } = await supabase
      .from("driver_identities")
      .select("driver_code")
      .in("driver_code", codesToCheck);
    if (dupErr) {
      console.error(dupErr);
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }
    if ((dupCodes ?? []).length > 0) {
      return NextResponse.json(
        { error: "このドライバーコードは既に使用されています" },
        { status: 400 },
      );
    }

    const { data: listRows } = await supabase
      .from("drivers")
      .select("list_no")
      .eq("org_id", orgId)
      .eq("works_as_driver", true);

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
        works_as_driver: true,
        pin_hash: pinHash,
        company_code: resolvedCompany,
        office_code: officeCode,
        driver_code: driverCode.toUpperCase(),
        list_no: nextListNo,
        postal_code: typeof postalCode === "string" ? postalCode.trim() || null : null,
        address: typeof address === "string" ? address.trim() || null : null,
        // 電話番号は E.164 で保存する。国内表記のまま入れると SMS ログインの
        // 照合（toE164JP した値で引く）に掛からなくなる（2026-08-05 本番で確認）。
        phone: typeof phone === "string" ? toE164JP(phone) || phone.trim() || null : null,
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
        // 電話番号は E.164 で保存する。国内表記のまま入れると SMS ログインの
        // 照合（toE164JP した値で引く）に掛からなくなる（2026-08-05 本番で確認）。
        phone: typeof phone === "string" ? toE164JP(phone) || phone.trim() || null : null,
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
      // 補償: 直前に作成した drivers 行を取り消し、孤児を残さない。
      await supabase.from("drivers").delete().eq("id", driver.id);
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
      // 補償: drivers / identities を取り消して孤児を残さない。
      await supabase.from("drivers").delete().eq("id", driver.id);
      await supabase.from("identities").delete().eq("id", identity.id);
      // driver_code の一意制約(23505)＝事前検査をすり抜けた競合。明確なメッセージで返す。
      if ((iErr as { code?: string } | null)?.code === "23505") {
        return NextResponse.json(
          { error: "このドライバーコードは既に使用されています" },
          { status: 400 },
        );
      }
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

    if (code2 && oc2pre.length === 6 && /^\d{6}$/.test(oc2pre)) {
      if (code2.slice(0, 3) === resolvedCompany) {
        const { data: ident2, error: e2 } = await supabase
          .from("driver_identities")
          .insert({
            driver_id: driver.id,
            slot: 2,
            driver_code: code2,
            office_code: oc2pre,
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
