import { NextResponse } from "next/server";

export class AuthzUnavailableError extends Error {
  constructor() { super("権限を確認できませんでした。時間をおいてもう一度お試しください"); }
}

export const authzUnavailable = () => NextResponse.json(
  { error: new AuthzUnavailableError().message }, { status: 503 },
);
