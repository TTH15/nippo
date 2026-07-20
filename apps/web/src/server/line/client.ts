// ============================================================
// LINE Messaging API クライアント（統合公式アカウント1本）。
// SDK は入れず fetch 直叩き（使うのは push / multicast / reply の3つだけ）。
//
// ★broadcast（全友だち配信）は意図的に実装しない。
//   notification-flow §1-3 レイヤ2「テナント通知で broadcast 禁止」の
//   最も強い担保 = そもそも呼べる関数を置かないこと。
//   プラットフォーム告知レーン（§1-4）が必要になったら、そのとき別モジュールに隔離して足す。
//
//   env: LINE_CHANNEL_ACCESS_TOKEN（長期）/ LINE_CHANNEL_SECRET（署名検証は signature.ts）
// ============================================================

const API_BASE = "https://api.line.me/v2/bot";

/** multicast の1回あたり上限（LINE 仕様）。 */
const MULTICAST_CHUNK = 500;

function getAccessToken(): string {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) throw new Error("LINE 未設定（LINE_CHANNEL_ACCESS_TOKEN）");
  return token;
}

/** LINE 連携が有効か（未設定環境ではインボックスのみで動かすため）。 */
export function isLineConfigured(): boolean {
  return Boolean(process.env.LINE_CHANNEL_ACCESS_TOKEN && process.env.LINE_CHANNEL_SECRET);
}

async function callLine(path: string, body: unknown): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getAccessToken()}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    // LINE のエラーボディ（{message, details}）は原因特定に必要なので本文ごと載せる
    const detail = await res.text().catch(() => "");
    throw new Error(`LINE API ${path} が失敗しました (${res.status}): ${detail}`);
  }
}

/** 単一ユーザーへ push。 */
export async function pushText(lineUserId: string, text: string): Promise<void> {
  await callLine("/message/push", { to: lineUserId, messages: [{ type: "text", text }] });
}

/**
 * 明示的な userId リストへ multicast（500件ずつ分割）。
 * 同一本文を多人数へ送る一斉配信用。呼び出し側で org スコープ済みのリストを渡すこと。
 */
export async function multicastText(lineUserIds: string[], text: string): Promise<void> {
  const unique = [...new Set(lineUserIds)];
  for (let i = 0; i < unique.length; i += MULTICAST_CHUNK) {
    const chunk = unique.slice(i, i + MULTICAST_CHUNK);
    await callLine("/message/multicast", { to: chunk, messages: [{ type: "text", text }] });
  }
}

/** webhook への応答（replyToken は1回限り・約1分で失効）。 */
export async function replyText(replyToken: string, text: string): Promise<void> {
  await callLine("/message/reply", { replyToken, messages: [{ type: "text", text }] });
}
