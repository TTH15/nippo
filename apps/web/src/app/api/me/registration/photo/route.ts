import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";
import { resolveIdentityId } from "@/server/identity";
import { checkImage, uploadKycImage, type KycKind } from "@/server/kyc/storage";

export const dynamic = "force-dynamic";

// 本登録: 免許証 / 顔写真を非公開 Storage にアップロードし、identities に保存パスを刻む。
export async function POST(req: NextRequest) {
  const user = await requireAuth(req, "DRIVER");
  if (isAuthError(user)) return user;

  try {
    const body = await req.json();
    const kind = body.kind as KycKind;
    const base64 = typeof body.base64 === "string" ? body.base64 : "";
    const mime = typeof body.mime === "string" ? body.mime : "";

    if (kind !== "license" && kind !== "face") {
      return NextResponse.json({ error: "種別が不正です" }, { status: 400 });
    }
    if (!base64) {
      return NextResponse.json({ error: "画像がありません" }, { status: 400 });
    }

    const identityId = await resolveIdentityId(user);
    if (!identityId) {
      return NextResponse.json({ error: "アカウント情報が不完全です" }, { status: 400 });
    }

    const bytes = Buffer.from(base64, "base64");
    const check = checkImage(mime, bytes.byteLength);
    if (!check.ok) {
      return NextResponse.json({ error: check.message }, { status: 400 });
    }

    const up = await uploadKycImage(supabase, identityId, kind, { bytes, mime });
    if (!up.ok) {
      return NextResponse.json({ error: up.message }, { status: 500 });
    }

    const column = kind === "license" ? "license_photo_path" : "face_photo_path";
    const { error } = await supabase.from("identities").update({ [column]: up.path }).eq("id", identityId);
    if (error) {
      console.error("[registration/photo] update error", error);
      return NextResponse.json({ error: "保存に失敗しました" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[registration/photo]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
