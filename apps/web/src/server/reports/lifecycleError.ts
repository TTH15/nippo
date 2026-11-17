import { NextResponse } from "next/server";

export function reportLifecycleError(error: { code?: string; message?: string }, fallback: string) {
  if (error.code === "P0002") return NextResponse.json({ error: "対象が見つかりません" }, { status: 404 });
  if (["23514", "23505", "40001", "55P03", "40P01"].includes(error.code ?? "")) {
    const message = error.message && /[ぁ-龠]/.test(error.message) ? error.message : "日報またはシフトが変更されています。再読み込みして確認してください";
    return NextResponse.json({ error: message }, { status: 409 });
  }
  if (["22023", "22P02", "22003"].includes(error.code ?? "")) return NextResponse.json({ error: "日報の内容を確認してください" }, { status: 400 });
  return NextResponse.json({ error: fallback }, { status: 500 });
}
