import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/server/db/client";
import { toE164JP } from "@/server/otp/phone";
import { checkOtp } from "@/server/otp/twilio";

export const dynamic = "force-dynamic";

// ============================================================
// 公開・参加API（仮登録）。認証不要。
// 氏名＋電話(SMS OTP検証)＋join_code で identity＋membership(drivers) を status='pending' 作成。
// driver_code/PIN は付けない＝運営が承認時に発行。トークンも発行しない。
// プライバシー: 仮登録は氏名＋電話のみ。免許等の重い PII は本登録（承認後）。
// identity は検証済み電話で重複排除（誤org→正org の出し直しで二重化しない）。
//   設計: docs/platform-design.md §2-2, §7 Phase 7 / memory tenant-migration（仮登録設計）
// ============================================================

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const joinCode = typeof body.joinCode === "string" ? body.joinCode.trim().toUpperCase() : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const code = typeof body.code === "string" ? body.code.trim() : "";
    const phone = toE164JP(typeof body.phone === "string" ? body.phone : "");

    if (!joinCode) {
      return NextResponse.json({ error: "参加コードを入力してください" }, { status: 400 });
    }
    if (!name) {
      return NextResponse.json({ error: "氏名を入力してください" }, { status: 400 });
    }
    if (!phone) {
      return NextResponse.json({ error: "電話番号の形式が正しくありません" }, { status: 400 });
    }
    if (!code) {
      return NextResponse.json({ error: "認証コードを入力してください" }, { status: 400 });
    }

    // join_code → org（active のみ受け付ける）
    const { data: org, error: orgErr } = await supabase
      .from("organizations")
      .select("id, name, status")
      .eq("join_code", joinCode)
      .maybeSingle();
    if (orgErr) {
      console.error("[Join] org lookup error:", orgErr);
      return NextResponse.json({ error: "サーバーエラー" }, { status: 500 });
    }
    if (!org || org.status !== "active") {
      return NextResponse.json({ error: "参加コードが無効です" }, { status: 400 });
    }

    // SMS OTP をサーバ側で検証（approved 必須）。
    const approved = await checkOtp(phone, code);
    if (!approved) {
      return NextResponse.json({ error: "認証コードが正しくありません" }, { status: 400 });
    }

    // identity を「検証済み電話」で find-or-create（重複排除）。
    // migration 091 で identities(phone) は検証済みのみ一意。並行/再送でも二重作成しない。
    const verifiedNow = new Date().toISOString();
    let identityId: string;
    const { data: existing } = await supabase
      .from("identities")
      .select("id")
      .eq("phone", phone)
      .order("phone_verified_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    if (existing) {
      identityId = existing.id;
      // 検証時刻を更新（未検証 legacy 行ならここで検証済みに昇格）。
      await supabase.from("identities").update({ phone_verified_at: verifiedNow }).eq("id", identityId);
    } else {
      const { data: identity, error: identErr } = await supabase
        .from("identities")
        .insert({ name, phone, phone_verified_at: verifiedNow })
        .select("id")
        .single();
      if (identErr?.code === "23505") {
        // 並行 join で先に作られた → 既存を採用（冪等）。
        const { data: raced } = await supabase
          .from("identities")
          .select("id")
          .eq("phone", phone)
          .order("phone_verified_at", { ascending: false, nullsFirst: false })
          .limit(1)
          .maybeSingle();
        if (!raced) {
          console.error("[Join] identity race resolve failed:", identErr);
          return NextResponse.json({ error: "申請の作成に失敗しました" }, { status: 500 });
        }
        identityId = raced.id;
      } else if (identErr || !identity) {
        console.error("[Join] identity insert error:", identErr);
        return NextResponse.json({ error: "申請の作成に失敗しました" }, { status: 500 });
      } else {
        identityId = identity.id;
      }
    }

    // 多重申請の抑止: 同 org に同 identity の有効な membership が既にあれば作らず ok。
    // migration 091 の uq_drivers_identity_org_active(却下以外で一意)と整合。
    const { data: dup } = await supabase
      .from("drivers")
      .select("id")
      .eq("org_id", org.id)
      .eq("identity_id", identityId)
      .neq("status", "rejected")
      .limit(1)
      .maybeSingle();
    if (dup) {
      return NextResponse.json({ ok: true, organizationName: org.name, alreadyApplied: true });
    }

    // membership（drivers）を pending で作成。driver_code/PIN は承認時に発行。
    const { error: dErr } = await supabase.from("drivers").insert({
      org_id: org.id,
      identity_id: identityId,
      role: "DRIVER",
      status: "pending",
      name,
      phone,
    });
    if (dErr) {
      // 並行申請で一意制約に当たった場合は「申請済み」として冪等に成功扱い。
      if (dErr.code === "23505") {
        return NextResponse.json({ ok: true, organizationName: org.name, alreadyApplied: true });
      }
      console.error("[Join] membership insert error:", dErr);
      return NextResponse.json({ error: "申請の作成に失敗しました" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, organizationName: org.name });
  } catch (err) {
    console.error("[Join] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
