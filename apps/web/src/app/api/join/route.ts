import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/server/db/client";
import { toE164JP } from "@/server/otp/phone";
import { checkOtp } from "@/server/otp/twilio";
import { issueDriverSession, type ActiveDriverRow } from "@/server/identity";

export const dynamic = "force-dynamic";

// ============================================================
// 公開・参加API（申請）。認証不要。
// 氏名＋生年月日＋電話(SMS OTP検証)＋join_code で identity＋membership(drivers) を
// status='pending' 作成し、pending のままセッションを発行する（§2-1a 一本化フロー）。
// 申請者はこのセッションで同じ web セッション内の本登録（免許/顔/住所/口座）まで完了し、
// 運営は KYC が揃った状態で1回だけ承認する（仮承認/本承認の2段階は統合済み）。
// driver_code は承認時に運営が発行。稼働解放のゲートは status='active'＋kyc_verified_at。
// identity は検証済み電話で重複排除（誤org→正org の出し直しで二重化しない）。
//   設計: docs/platform-design.md §2-1a, §2-2, §7 Phase 7
// ============================================================

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DRIVER_SESSION_COLS =
  "id, name, role, company_code, office_code, driver_code, identity_id, org_id, status";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const joinCode = typeof body.joinCode === "string" ? body.joinCode.trim().toUpperCase() : "";
    const inviteToken = typeof body.invite === "string" ? body.invite.trim() : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const nameKana = typeof body.nameKana === "string" ? body.nameKana.trim() : "";
    const code = typeof body.code === "string" ? body.code.trim() : "";
    const phone = toE164JP(typeof body.phone === "string" ? body.phone : "");
    const dob = typeof body.dob === "string" ? body.dob.trim() : "";
    const termsAgreed = body.termsAgreed === true;

    if (dob && !DATE_RE.test(dob)) {
      return NextResponse.json({ error: "生年月日は YYYY-MM-DD で入力してください" }, { status: 400 });
    }
    // 同意は必須（ウィザードの「ようこそ」でチェック→ここで identity に記録・migration 115）。
    if (!termsAgreed) {
      return NextResponse.json({ error: "利用規約とプライバシーポリシーへの同意が必要です" }, { status: 400 });
    }

    if (!joinCode && !inviteToken) {
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

    // 入口の解決: 単回招待トークン（優先）または共有 join_code → active org。
    // 招待の「消費」はここではしない（OTP 検証と重複申請チェックの後、membership 作成の直前）。
    let org: { id: string; name: string; status: string } | null = null;
    let inviteId: string | null = null;
    if (inviteToken) {
      const { data: inv, error: invErr } = await supabase
        .from("invites")
        .select("id, used_at, revoked_at, expires_at, organizations ( id, name, status )")
        .eq("token", inviteToken)
        .maybeSingle();
      if (invErr) {
        console.error("[Join] invite lookup error:", invErr);
        return NextResponse.json({ error: "サーバーエラー" }, { status: 500 });
      }
      // 使用済み・失効・期限切れも同じ中立メッセージ（lookup と同様、情報を漏らさない）。
      const invOrg = (inv?.organizations ?? null) as { id: string; name: string; status: string } | null;
      if (
        !inv ||
        !invOrg ||
        invOrg.status !== "active" ||
        inv.revoked_at ||
        inv.used_at ||
        new Date(inv.expires_at).getTime() < Date.now()
      ) {
        return NextResponse.json(
          { error: "この招待リンクは無効です。運営にお問い合わせください" },
          { status: 400 },
        );
      }
      inviteId = inv.id;
      org = invOrg;
    } else {
      const { data: byCode, error: orgErr } = await supabase
        .from("organizations")
        .select("id, name, status")
        .eq("join_code", joinCode)
        .maybeSingle();
      if (orgErr) {
        console.error("[Join] org lookup error:", orgErr);
        return NextResponse.json({ error: "サーバーエラー" }, { status: 500 });
      }
      org = byCode;
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
      // 検証時刻・同意時刻を更新（未検証 legacy 行ならここで検証済みに昇格）。dob/カナは入力があれば反映。
      await supabase
        .from("identities")
        .update({
          phone_verified_at: verifiedNow,
          terms_agreed_at: verifiedNow,
          ...(dob ? { dob } : {}),
          ...(nameKana ? { name_kana: nameKana } : {}),
        })
        .eq("id", identityId);
    } else {
      const { data: identity, error: identErr } = await supabase
        .from("identities")
        .insert({
          name,
          phone,
          phone_verified_at: verifiedNow,
          terms_agreed_at: verifiedNow,
          ...(dob ? { dob } : {}),
          ...(nameKana ? { name_kana: nameKana } : {}),
        })
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
      .select(DRIVER_SESSION_COLS)
      .eq("org_id", org.id)
      .eq("identity_id", identityId)
      .neq("status", "rejected")
      .limit(1)
      .maybeSingle();
    if (dup) {
      // 申請済みでも OTP 検証は済んでいるので、中断した本登録を再開できるよう
      // セッションを再発行する（pending/active のみ。inactive は稼働終了のため発行しない）。
      const session =
        dup.status === "pending" || dup.status === "active"
          ? await issueDriverSession(dup as ActiveDriverRow)
          : null;
      return NextResponse.json({
        ok: true,
        organizationName: org.name,
        alreadyApplied: true,
        ...(session ?? {}),
      });
    }

    // 単回招待の消費（コミットポイント）。used_at IS NULL の行だけを条件付き UPDATE し、
    // 0行なら並行使用に負けた＝使用済みとして弾く。申請済み（dup）の再開は招待を消費せず上で通す。
    if (inviteId) {
      const { data: burned } = await supabase
        .from("invites")
        .update({ used_at: verifiedNow, used_by_identity: identityId })
        .eq("id", inviteId)
        .is("used_at", null)
        .select("id")
        .maybeSingle();
      if (!burned) {
        return NextResponse.json(
          { error: "この招待リンクは無効です。運営にお問い合わせください" },
          { status: 400 },
        );
      }
    }

    // membership（drivers）を pending で作成。driver_code は承認時に発行。
    const { data: created, error: dErr } = await supabase
      .from("drivers")
      .insert({
        org_id: org.id,
        identity_id: identityId,
        role: "DRIVER",
        status: "pending",
        name,
        phone,
      })
      .select(DRIVER_SESSION_COLS)
      .single();
    if (dErr || !created) {
      // 並行申請で一意制約に当たった場合は「申請済み」として冪等に成功扱い。
      if (dErr?.code === "23505") {
        const { data: raced } = await supabase
          .from("drivers")
          .select(DRIVER_SESSION_COLS)
          .eq("org_id", org.id)
          .eq("identity_id", identityId)
          .neq("status", "rejected")
          .limit(1)
          .maybeSingle();
        const session =
          raced && (raced.status === "pending" || raced.status === "active")
            ? await issueDriverSession(raced as ActiveDriverRow)
            : null;
        return NextResponse.json({
          ok: true,
          organizationName: org.name,
          alreadyApplied: true,
          ...(session ?? {}),
        });
      }
      console.error("[Join] membership insert error:", dErr);
      return NextResponse.json({ error: "申請の作成に失敗しました" }, { status: 500 });
    }

    // pending のままセッション発行（本登録を同一セッションで続けるため・§2-1a）。
    // 稼働系の解放は status/kyc_verified_at を見る各ルートが引き続きゲートする。
    const session = await issueDriverSession(created as ActiveDriverRow);
    return NextResponse.json({ ok: true, organizationName: org.name, ...session });
  } catch (err) {
    console.error("[Join] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
