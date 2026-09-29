import { NextRequest, NextResponse } from "next/server";
import { clearAdminRenewCookie } from "@/server/auth/adminRenew";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (req.headers.get("origin") !== req.nextUrl.origin) {
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  }
  const response = NextResponse.json({ ok: true });
  clearAdminRenewCookie(response);
  return response;
}
