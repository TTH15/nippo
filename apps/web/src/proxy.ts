import { NextRequest, NextResponse } from "next/server";

// 管理画面はリクエストごとにnonceを生成する。Nextの初期化scriptにも同じnonceが付く。
// PDF/OCRのWASMと地図のWorkerは許可し、任意のインラインJSは許可しない。
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = [
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
    "worker-src 'self' blob:", "object-src 'none'", "base-uri 'self'", "frame-ancestors 'self'",
  ].join("; ");
  const headers = new Headers(request.headers);
  headers.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
export const config = { matcher: ["/admin/:path*"] };
