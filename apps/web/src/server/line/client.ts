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

/** GET 系（通数照会）。エラーは呼び出し側で握って UI を止めない。 */
async function getLine<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${getAccessToken()}` },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`LINE API ${path} が失敗しました (${res.status}): ${detail}`);
  }
  return (await res.json()) as T;
}

export type LineQuota = {
  /** 今月の上限。無制限プランなら null。 */
  limit: number | null;
  /** 今月これまでに送った通数（チャネル全体）。 */
  used: number;
  /** 残り。無制限なら null。 */
  remaining: number | null;
};

/**
 * チャネル全体の今月の通数を取得する。
 * ★org 単位の内訳は LINE からは取れない（統合1本のチャネル合計のみ）。
 * type が "none" のプランは上限なし（従量）＝ limit/remaining は null。
 */
export async function getMessageQuota(): Promise<LineQuota> {
  const [quota, consumption] = await Promise.all([
    getLine<{ type: string; value?: number }>("/message/quota"),
    getLine<{ totalUsage: number }>("/message/quota/consumption"),
  ]);
  const limit = quota.type === "limited" && typeof quota.value === "number" ? quota.value : null;
  const used = consumption.totalUsage;
  return {
    limit,
    used,
    remaining: limit === null ? null : Math.max(0, limit - used),
  };
}

/**
 * 送信できるメッセージ。
 * flex は見た目だけの器で、altText に必ずテキスト版を入れる
 * （通知バナー・Flex 非対応環境ではこちらが読まれる）。
 */
export type LineMessage =
  | { type: "text"; text: string }
  | { type: "flex"; altText: string; contents: Record<string, unknown> };

/** 単一ユーザーへ push。 */
export async function pushText(lineUserId: string, text: string): Promise<void> {
  await pushMessages(lineUserId, [{ type: "text", text }]);
}

/** 単一ユーザーへ push（カード等の任意メッセージ）。 */
export async function pushMessages(lineUserId: string, messages: LineMessage[]): Promise<void> {
  await callLine("/message/push", { to: lineUserId, messages });
}

/**
 * 明示的な userId リストへ multicast（500件ずつ分割）。
 * 同一本文を多人数へ送る一斉配信用。呼び出し側で org スコープ済みのリストを渡すこと。
 */
export async function multicastText(lineUserIds: string[], text: string): Promise<void> {
  await multicastMessages(lineUserIds, [{ type: "text", text }]);
}

/** multicast（カード等の任意メッセージ）。同一内容を送る相手だけをまとめて渡すこと。 */
export async function multicastMessages(
  lineUserIds: string[],
  messages: LineMessage[],
): Promise<void> {
  const unique = [...new Set(lineUserIds)];
  for (let i = 0; i < unique.length; i += MULTICAST_CHUNK) {
    const chunk = unique.slice(i, i + MULTICAST_CHUNK);
    await callLine("/message/multicast", { to: chunk, messages });
  }
}

/** webhook への応答（replyToken は1回限り・約1分で失効）。 */
export async function replyText(replyToken: string, text: string): Promise<void> {
  await callLine("/message/reply", { replyToken, messages: [{ type: "text", text }] });
}
