import { normalizeBankAccount, bankFields, requiresBankChangePasskey } from "@/lib/bankAccount";
import { readOwnBank, bankSnapshotValues, consumeBankChangeGrant, type BankSnapshot } from "@/server/auth/bankChangeAuth";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";
import { resolveIdentityId } from "@/server/identity";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

// GET: 本登録の現在状態（プリフィル＋完了判定）。
export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "DRIVER");
  if (isAuthError(user)) return user;

  const identityId = await resolveIdentityId(user);
  if (!identityId) return NextResponse.json({ error: "アカウント情報が不完全です" }, { status: 400 });

  const { data: identity } = await supabase
    .from("identities")
    .select("name, dob, license_expiry, license_photo_path, face_photo_path")
    .eq("id", identityId)
    .single();
  const { data: driver, error: driverError } = await supabase
    // tenant-scope-ok: requireAuth由来の本人user.driverIdだけを読み書きする
    .from("drivers")
    .select("postal_code, address, address_matches_license, bank_name, bank_no, bank_holder, bank_branch_name, bank_account_type, kyc_verified_at, onboarding_requires_passkey")
    .eq("id", user.driverId)
    .single();

  if (driverError || !driver) return NextResponse.json({ error: "登録状況を確認できませんでした。もう一度お試しください" }, { status: 503 });

  const bank = bankSnapshotValues({ bank_name: driver.bank_name ?? null, bank_no: driver.bank_no ?? null, bank_holder: driver.bank_holder ?? null, bank_branch_name: driver.bank_branch_name ?? null, bank_account_type: driver.bank_account_type ?? null });

  const hasLicensePhoto = !!identity?.license_photo_path;
  const hasFacePhoto = !!identity?.face_photo_path;
  const { count, error: passkeyError } = await supabase.from("passkey_credentials")
    .select("id", { count: "exact", head: true }).eq("identity_id", identityId);
  if (passkeyError) {
    return NextResponse.json({ error: "ログイン設定を確認できませんでした。もう一度お試しください" }, { status: 503 });
  }
  // 口座は本登録の完了条件から除外（2026-07-25）。初回の報酬支払いまでに
  // アプリ（マイページ）で登録してもらう。POST での受け付け・保存は従来どおり。
  const complete =
    hasLicensePhoto &&
    hasFacePhoto &&
    !!identity?.license_expiry &&
    !!driver?.postal_code &&
    !!driver?.address;

  return NextResponse.json({
    name: identity?.name ?? "",
    dob: identity?.dob ?? "",
    licenseExpiry: identity?.license_expiry ?? "",
    hasLicensePhoto,
    hasFacePhoto,
    hasPasskey: (count ?? 0) > 0,
    passkeyRequired: driver?.onboarding_requires_passkey === true,
    postalCode: driver?.postal_code ?? "",
    address: driver?.address ?? "",
    addressMatchesLicense: (driver?.address_matches_license as boolean | null) ?? null,
    bankName: bank.bankName,
    bankBranch: bank.bankBranch ?? "",
    bankType: bank.bankType ?? "",
    bankNo: driver?.bank_no ?? "",
    bankHolder: driver?.bank_holder ?? "",
    complete,
    kycVerified: !!driver?.kyc_verified_at,
  });
}

// POST: 本登録のテキスト項目を「部分更新」で保存（ウィザードのステップごと）。
// body に含まれた項目だけ更新する。完了判定は GET の complete に委ねる。
export async function POST(req: NextRequest) {
  const user = await requireAuth(req, "DRIVER");
  if (isAuthError(user)) return user;

  try {
    const body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "登録内容を確認してください" }, { status: 400 });
    const bankTouched = bankFields.some(key => Object.hasOwn(body, key));
    let bankBefore: BankSnapshot | null = null;
    if (bankTouched) {
      if (["dob", "licenseExpiry", "postalCode", "address", "addressMatchesLicense"].some(key => Object.hasOwn(body, key))) return NextResponse.json({ error: "振込口座はほかの登録内容と分けて保存してください" }, { status: 400 });
      try { bankBefore = await readOwnBank(user); }
      catch { return NextResponse.json({ error: "振込口座を確認できませんでした。もう一度お試しください" }, { status: 503 }); }
      const previous = bankSnapshotValues(bankBefore);
      const bank = normalizeBankAccount({ ...previous, ...Object.fromEntries(bankFields.filter(key => Object.hasOwn(body, key)).map(key => [key, body[key]])) });
      if (!bank) return NextResponse.json({ error: "銀行名、支店名、口座種別、8桁以内の口座番号、口座名義を確認してください" }, { status: 400 });
      const changed = bankFields.some(key => (bank[key] ?? "") !== (previous[key] ?? "").trim());
      if (requiresBankChangePasskey(previous, bank)) {
        let confirmed;
        try { confirmed = await consumeBankChangeGrant(req, user, bankBefore, bank); }
        catch { return NextResponse.json({ error: "本人確認を確認できませんでした。もう一度お試しください" }, { status: 503 }); }
        if (!confirmed) return NextResponse.json({ error: "振込口座を変更するには、パスキーでもう一度本人確認をしてください", code: "BANK_PASSKEY_REQUIRED" }, { status: 403 });
      }
      // 同じ口座の再送は書き換えず、確認情報の再利用を求めない。
      if (!changed) return NextResponse.json({ ok: true });
      for (const key of bankFields) if (bank[key] !== undefined) body[key] = bank[key];
    }
    const idUpdate: Record<string, unknown> = {};
    const drvUpdate: Record<string, unknown> = {};

    if (body.licenseExpiry !== undefined) {
      const v = str(body.licenseExpiry);
      if (v && !DATE_RE.test(v)) {
        return NextResponse.json({ error: "免許有効期限は YYYY-MM-DD で入力してください" }, { status: 400 });
      }
      idUpdate.license_expiry = v || null;
      drvUpdate.license_expiry_date = v || null; // 旧モデル互換（admin の license badge 等）
    }
    if (body.dob !== undefined) {
      const v = str(body.dob);
      if (v && !DATE_RE.test(v)) {
        return NextResponse.json({ error: "生年月日は YYYY-MM-DD で入力してください" }, { status: 400 });
      }
      idUpdate.dob = v || null;
    }
    if (body.postalCode !== undefined) drvUpdate.postal_code = str(body.postalCode) || null;
    if (body.address !== undefined) drvUpdate.address = str(body.address) || null;
    // 本人申告「住所は免許証記載と同じ」（migration 117）。承認時の運営確認材料。
    if (body.addressMatchesLicense !== undefined) {
      drvUpdate.address_matches_license = body.addressMatchesLicense === true;
    }
    // 既存の管理画面・請求書・mobileが使う銀行＋支店表記も維持する。
    if (body.bankName !== undefined) drvUpdate.bank_name = [str(body.bankName), str(body.bankBranch)].filter(Boolean).join(" ") || null;
    if (body.bankBranch !== undefined) drvUpdate.bank_branch_name = str(body.bankBranch) || null;
    if (body.bankType !== undefined) drvUpdate.bank_account_type = str(body.bankType) || null;
    if (body.bankNo !== undefined) drvUpdate.bank_no = str(body.bankNo) || null;
    if (body.bankHolder !== undefined) drvUpdate.bank_holder = str(body.bankHolder) || null;

    const identityId = await resolveIdentityId(user);
    if (!identityId) return NextResponse.json({ error: "アカウント情報が不完全です" }, { status: 400 });

    if (Object.keys(idUpdate).length > 0) {
      const { error } = await supabase.from("identities").update(idUpdate).eq("id", identityId);
      if (error) {
        console.error("[registration] identity update", error);
        return NextResponse.json({ error: "保存に失敗しました" }, { status: 500 });
      }
    }
    if (Object.keys(drvUpdate).length > 0) {
      // tenant-scope-ok: requireAuth由来の本人user.driverIdだけを読み書きする
      let query = supabase.from("drivers").update(drvUpdate).eq("id", user.driverId);
      if (bankBefore) {
        // 初回登録も比較更新する。他端末が先に登録した口座を無確認で上書きしない。
        for (const key of ["bank_name", "bank_no", "bank_holder", "bank_branch_name", "bank_account_type"] as const) query = bankBefore[key] == null ? query.is(key, null) : query.eq(key, bankBefore[key]);
      }
      const { data, error } = bankBefore ? await query.select("id").maybeSingle() : await query;
      if (error) {
        console.error("[registration] driver update failed");
        return NextResponse.json({ error: "保存に失敗しました" }, { status: 500 });
      }
      if (bankBefore && !data) return NextResponse.json({ error: "振込口座が変更されています。登録内容を読み込み直してください", code: "BANK_ACCOUNT_CHANGED" }, { status: 409 });
    }

    return NextResponse.json({ ok: true });
  } catch {
    console.error("[registration] failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
