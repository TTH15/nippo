// ============================================================
// SMS OTP（Twilio Verify）。コード生成・失効・レート制限・不正対策は Verify が担当。
// サーバ側に OTP 状態を持たない（テーブル不要）。
//   env: TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_VERIFY_SERVICE_SID
// ============================================================
import twilio from "twilio";

function getClient() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID;
  if (!sid || !token || !serviceSid) {
    throw new Error("Twilio 未設定（TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_VERIFY_SERVICE_SID）");
  }
  return { client: twilio(sid, token), serviceSid };
}

/** 認証コードを SMS 送信する（Verify が生成・送信）。 */
export async function sendOtp(phoneE164: string): Promise<void> {
  const { client, serviceSid } = getClient();
  await client.verify.v2.services(serviceSid).verifications.create({ to: phoneE164, channel: "sms" });
}

/** 入力コードを検証する。approved なら true。 */
export async function checkOtp(phoneE164: string, code: string): Promise<boolean> {
  const { client, serviceSid } = getClient();
  try {
    const res = await client.verify.v2.services(serviceSid).verificationChecks.create({ to: phoneE164, code });
    return res.status === "approved";
  } catch {
    // 期限切れ・試行超過などは未承認扱い
    return false;
  }
}
