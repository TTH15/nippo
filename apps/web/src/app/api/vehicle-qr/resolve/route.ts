import { NextRequest, NextResponse } from "next/server";
import { requireTenant } from "@/server/db/tenant";
import { todayJST } from "@/lib/date";
import { resolveVehicleByToken, qrCodeMessage } from "@/server/vehicleQr/resolve";
import { parseQrPayload } from "@/server/vehicleQr/token";

export const dynamic = "force-dynamic";

// POST: ドライバーが車両QRをスキャンしたときの解決。
// token→vehicle をテナント横断で解決し、認可（所有org or 有効貸与の借用org）まで判定。
// 結果は必ず理由付きコードで返す（§8.3。出退勤の打刻自体は別API＝check-in/out で行う）。
// body: { token | qr } … スキャン文字列（生token or nippo://v/<token>）
export async function POST(req: NextRequest) {
  const ctx = await requireTenant(req, "DRIVER");
  if (ctx instanceof NextResponse) return ctx;
  const { orgId } = ctx;

  const body = await req.json().catch(() => ({}));
  const token = parseQrPayload(String(body?.token ?? body?.qr ?? ""));
  if (!token) {
    // 読み取れない＝退避ルート（プレートOCR）へ誘導
    return NextResponse.json({
      code: "unknown",
      ok: false,
      message: qrCodeMessage("unknown"),
    });
  }

  const result = await resolveVehicleByToken(token, orgId, todayJST());
  const ok = result.code === "ok";

  return NextResponse.json({
    code: result.code,
    ok,
    message: qrCodeMessage(result.code),
    usage: result.usage ?? null, // 'owner' | 'borrower' | null
    vehicle: result.vehicle
      ? {
          id: result.vehicle.id,
          numberPrefix: result.vehicle.numberPrefix,
          numberClass: result.vehicle.numberClass,
          numberHiragana: result.vehicle.numberHiragana,
          numberNumeric: result.vehicle.numberNumeric,
        }
      : null,
  });
}
