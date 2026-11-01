import { NextRequest, NextResponse } from "next/server";

// 管理画面はリクエストごとにnonceを生成する。Nextの初期化scriptにも同じnonceが付く。
// PDF/OCRのWASMと地図のWorkerは許可し、任意のインラインJSは許可しない。
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = [
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
    "worker-src 'self' blob:", "object-src 'none'", "base-uri 'self'", "frame-ancestors 'self'", "form-action 'self'",
  ].join("; ");
  const headers = new Headers(request.headers);
  headers.set("Content-Security-Policy", csp);
  headers.set("x-nonce", nonce);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
export const config = { matcher: ["/", "/admin/:path*", "/platform/:path*", "/login/:path*", "/join/:path*", "/register/:path*", "/account/:path*", "/submit/:path*", "/submit-v2/:path*", "/me/:path*", "/shifts/:path*", "/report/:path*", "/notifications/:path*"] };
