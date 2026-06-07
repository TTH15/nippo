import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";
import { checkFile, uploadReportFile } from "@/server/reportKinds/attachments";

export const dynamic = "force-dynamic";

// ドライバー: 諸報告の添付ファイルをアップロードし、参照(path等)を返す。
// multipart/form-data: file（単一）, fieldId（任意・呼び出し側でひも付け）。
export async function POST(req: NextRequest) {
  const user = await requireAuth(req, "DRIVER");
  if (isAuthError(user)) return user;

  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }
    const mime = file.type || "application/octet-stream";
    const size = file.size;
    const check = checkFile(mime, size);
    if (!check.ok) return NextResponse.json({ error: check.message }, { status: 400 });

    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await uploadReportFile(supabase, user.driverId as string, { bytes, name: file.name, mime });
    if (!result.ok) return NextResponse.json({ error: result.message }, { status: 500 });

    return NextResponse.json({ path: result.path, name: file.name, mime, size });
  } catch (err) {
    console.error("[reports/attachments] error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
