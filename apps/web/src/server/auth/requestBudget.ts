import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { NextResponse, type NextRequest } from "next/server";
import { supabase } from "@/server/db/client";

export class AuthRequestLimitError extends Error {
  constructor(readonly status: 429 | 503) {
    super(status === 429 ? "認証の回数が上限に達しました。時間をおいてお試しください" : "認証を開始できませんでした。時間をおいてお試しください");
  }
}
export const authLimitResponse = (error: unknown) => error instanceof AuthRequestLimitError
  ? NextResponse.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store", ...(error.status === 429 ? { "Retry-After": "60" } : {}) } }) : null;

/** 電話番号を保存せず、全インスタンスで共有する予算を消費する。 */
export async function consumeAuthBudget(kind: "sms-send" | "sms-check", phone: string, req?: NextRequest) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new AuthRequestLimitError(503);
  const hash = (value: string) => createHmac("sha256", secret).update(`auth-budget-v1:${value}`).digest("hex");
  // Vercelが付与するヘッダーのみ信頼する。自己申告のX-Forwarded-Forは使わない。
  const candidate = process.env.VERCEL === "1" ? req?.headers.get("x-vercel-forwarded-for")?.trim() : null;
  const ip = candidate && isIP(candidate) ? hash(`ip:${candidate}`) : null;
  const { data, error } = await supabase.rpc("consume_auth_request_budget", { p_kind: kind, p_subject: hash(`phone:${phone}`), p_ip: ip });
  if (error || typeof data !== "boolean") throw new AuthRequestLimitError(503);
  if (!data) {
    console.warn("[Auth] request budget exceeded", { kind });
    throw new AuthRequestLimitError(429);
  }
}
