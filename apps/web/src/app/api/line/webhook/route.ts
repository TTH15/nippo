import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/server/db/client";
import { verifyLineSignature } from "@/server/line/signature";
import { consumeLinkCode } from "@/server/line/linkCode";
import { replyText } from "@/server/line/client";

export const dynamic = "force-dynamic";

// ============================================================
// LINE Messaging API webhook（roadmap-2026-07 E②③）。
// ★当プロジェクトで唯一 requireAuth を通らないルート。
//   認証は x-line-signature の検証そのもの（署名が合わなければ 401）。
// 扱うイベント:
//   follow   … 友だち追加。連携コードの送信を案内する
//   unfollow … ブロック。line_blocked_at を立てて配信対象から外す（行は消さない）
//   message  … 本文をワンタイム連携コードとして突合し、identity と結合する
// LINE は 200 を返さないとリトライしてくるため、個々のイベント処理の失敗は
// ログに留めて常に 200 を返す（署名不正だけは 401）。
//   設計: docs/notification-flow.md §1-1
// ============================================================

type LineEvent = {
  type: string;
  replyToken?: string;
  source?: { userId?: string };
  message?: { type: string; text?: string };
};

const HELP_TEXT =
  "アプリの「LINE連携」画面に表示される6桁の連携コードを、このトークにそのまま送信してください。";

export async function POST(req: NextRequest) {
  // 署名は生ボディに対して計算する（JSON.parse 後では一致しない）
  const rawBody = await req.text();
  if (!verifyLineSignature(rawBody, req.headers.get("x-line-signature"))) {
    console.error("[line-webhook] 署名検証に失敗");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let events: LineEvent[] = [];
  try {
    events = (JSON.parse(rawBody)?.events ?? []) as LineEvent[];
  } catch {
    // LINE の疎通確認は空ボディで飛んでくることがある
    return NextResponse.json({ ok: true });
  }

  for (const event of events) {
    try {
      await handleEvent(event);
    } catch (e) {
      console.error("[line-webhook] イベント処理に失敗", event.type, e);
    }
  }

  return NextResponse.json({ ok: true });
}

async function handleEvent(event: LineEvent): Promise<void> {
  const lineUserId = event.source?.userId;
  if (!lineUserId) return;

  if (event.type === "unfollow") {
    // ブロック＝配信停止。再フォローで復活させるため連携自体は解除しない。
    await supabase
      .from("identities")
      .update({ line_blocked_at: new Date().toISOString() })
      .eq("line_user_id", lineUserId);
    return;
  }

  if (event.type === "follow") {
    await supabase
      .from("identities")
      .update({ line_blocked_at: null })
      .eq("line_user_id", lineUserId);

    if (event.replyToken) {
      const { data: known } = await supabase
        .from("identities")
        .select("id")
        .eq("line_user_id", lineUserId)
        .maybeSingle();
      await replyText(
        event.replyToken,
        known
          ? "友だち追加ありがとうございます。引き続きこちらにお知らせをお送りします。"
          : `友だち追加ありがとうございます。\n${HELP_TEXT}`,
      );
    }
    return;
  }

  if (event.type === "message" && event.message?.type === "text") {
    const text = (event.message.text ?? "").trim();
    if (!text || !event.replyToken) return;

    const result = await consumeLinkCode(text, lineUserId);
    await replyText(event.replyToken, linkReplyText(result));
  }
}

function linkReplyText(result: Awaited<ReturnType<typeof consumeLinkCode>>): string {
  if (result.ok) return "連携が完了しました。今後こちらにお知らせをお送りします。";
  switch (result.reason) {
    case "expired":
      return "この連携コードは有効期限が切れています。アプリで新しいコードを発行してください。";
    case "used":
      return "この連携コードは使用済みです。アプリで新しいコードを発行してください。";
    case "taken":
      return "この LINE アカウントは既に別の登録者と連携済みです。運営にお問い合わせください。";
    default:
      // コード以外のメッセージ（雑談・スタンプ代わりの文言）もここに落ちる
      return HELP_TEXT;
  }
}
