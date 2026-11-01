import type { PreviewFixture } from "@/lib/preview/fixtureStore";
export const recoverFixture: PreviewFixture<{ attempts: number; checks: number; verified: boolean; requested: boolean; recoveryChecks: number }> = {
  id: "recover", title: "SMSログイン", pathname: "/login/recover",
  scenarios: {
    normal: { label: "未設定", description: "ドライバーはSMS認証後にホームへ進む" },
    registered: { label: "登録済み", description: "SMS認証後はホームへ進む" },
    incomplete: { label: "申請途中", description: "SMS認証後は初期登録を再開する" },
    "admin-incomplete": { label: "運営・登録項目なし", description: "既存の運営アカウントはPasskey設定へ進む" },
    "admin-registered": { label: "運営・登録済み", description: "別端末にパスキーがある人も追加登録へ進める" },
    cancelled: { label: "認証中止", description: "パスキー登録を中止した際の案内を確認する" },
    "check-retry": { label: "状態確認失敗", description: "SMSを再送せずに登録状態だけ再確認する" },
    pending: { label: "復旧承認待ち", description: "別の管理者への承認待ち" },
    approved: { label: "復旧承認済み", description: "SMS確認と承認済み申請から1回だけキーを追加する" },
    "approve-on-refresh": { label: "承認状況更新", description: "承認状況を確認すると承認済みに変わる" },
    "approval-expired": { label: "承認期限切れ", description: "承認の期限切れを確認して再申請する" },
    retry: { label: "登録失敗", description: "登録が一度失敗し再試行できる" },
  },
  createState: () => ({ attempts: 0, checks: 0, verified: false, requested: false, recoveryChecks: 0 }),
  read: (state, { path, params }, { scenario }) => {
    if (path === "/api/auth/reauth") return { recent: params.get("purpose") === "recovery" || state.verified, canUseSms: params.get("purpose") === "recovery", hasPasskey: scenario !== "admin-incomplete", phoneMasked: "下4桁 0000" };
    if (path === "/api/auth/recovery-request") {
      const status = scenario === "approved" ? "approved" : scenario === "approval-expired" ? "expired" : scenario === "approve-on-refresh" && state.recoveryChecks++ > 0 ? "approved" : "pending";
      return { request: state.requested || ["pending", "approved", "approval-expired", "approve-on-refresh"].includes(scenario) ? { id: "00000000-0000-4000-8000-000000000050", status, expiresAt: "2026-11-03T00:00:00Z" } : null };
    }
    if (path === "/api/me/registration") {
      if (scenario === "check-retry" && state.checks++ === 0) throw new Error("一時的に確認できません");
      return {
        complete: scenario !== "incomplete" && scenario !== "admin-incomplete",
        kycVerified: scenario !== "incomplete" && scenario !== "admin-incomplete",
        hasPasskey: scenario === "registered" || scenario === "admin-registered",
      };
    }
    return undefined;
  },
  write: (state, { path, body }, { driver, scenario }) => {
    if (path === "/api/otp/send") return { ok: true };
    if (path === "/api/auth/recover/verify") return { token: "preview-only", driver: {
      ...driver, role: ["admin-incomplete", "admin-registered", "cancelled", "retry", "pending", "approved", "approval-expired", "approve-on-refresh"].includes(scenario) ? "ADMIN" : "DRIVER",
      capabilities: ["admin-incomplete", "admin-registered", "cancelled", "retry", "pending", "approved", "approval-expired", "approve-on-refresh"].includes(scenario) ? ["can_view_members"] : [],
    } };
    if (path === "/api/auth/reauth/options") return { options: {}, challengeToken: "preview-reauth" };
    if (path === "/api/auth/reauth/verify") { state.verified = body.method === "passkey"; return { reauthToken: "preview-proof" }; }
    if (path === "/api/auth/recovery-request") { state.requested = true; return { request: { id: "00000000-0000-4000-8000-000000000050", status: "pending", expiresAt: "2026-11-03T00:00:00Z" } }; }
    if (path === "/api/auth/webauthn/register/options") return { options: { previewCancel: scenario === "cancelled" }, challengeToken: "preview-only" };
    if (path === "/api/auth/webauthn/register/verify") {
      if (scenario === "retry" && state.attempts++ === 0) throw new Error("登録できませんでした");
      return { ok: true };
    }
    return undefined;
  },
};
