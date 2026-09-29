import { NextResponse } from "next/server";
import { appleAppIds } from "@/server/auth/nativeAssociation";

export const dynamic = "force-dynamic";
export function GET() {
  try {
    const apps = appleAppIds();
    if (!apps.length) throw new Error("Not configured");
    return NextResponse.json({ webcredentials: { apps } }, { headers: { "Cache-Control": "public, max-age=300" } });
  } catch {
    return NextResponse.json({ error: "Not configured" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
