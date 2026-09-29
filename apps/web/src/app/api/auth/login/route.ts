import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// 旧クライアントには廃止理由を返す。本人のパスキー・SMS経路は別API。
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (body?.loginType === "admin") {
    return NextResponse.json({ error: "管理者コードでのログインは終了しました。かんたんログインを使ってください", code: "ADMIN_CODE_LOGIN_RETIRED" }, { status: 410 });
  }
  if (body?.loginType === "driver") {
    return NextResponse.json({ error: "PINログインは終了しました。かんたんログインまたは電話番号をお使いください", code: "PIN_LOGIN_RETIRED" }, { status: 410 });
  }
  return NextResponse.json({ error: "Invalid login type" }, { status: 400 });
}
