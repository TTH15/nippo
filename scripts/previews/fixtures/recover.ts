import type { PreviewFixture } from "@/lib/preview/fixtureStore";
export const recoverFixture: PreviewFixture<{ attempts: number }> = {
  id: "recover", title: "SMSログイン", pathname: "/login/recover",
  scenarios: {
    normal: { label: "Passkey未登録", description: "SMS認証後にPasskey登録を案内する" },
    registered: { label: "登録済み", description: "SMS認証後はホームへ進む" },
    incomplete: { label: "申請途中", description: "SMS認証後は初期登録を再開する" },
    retry: { label: "登録失敗", description: "登録が一度失敗し再試行できる" },
  },
  createState: () => ({ attempts: 0 }),
  read: (_state, { path }, { scenario }) => path === "/api/auth/reauth" ? { recent: true, canUseSms: true, hasPasskey: false, phoneMasked: "下4桁 0000" } : path === "/api/me/registration" ? {
    complete: scenario !== "incomplete", kycVerified: scenario !== "incomplete", hasPasskey: scenario === "registered",
  } : undefined,
  write: (state, { path }, { driver, scenario }) => {
    if (path === "/api/otp/send") return { ok: true };
    if (path === "/api/auth/recover/verify") return { token: "preview-only", driver: { ...driver, role: "DRIVER", capabilities: [] } };
    if (path === "/api/auth/webauthn/register/options") return { options: {}, challengeToken: "preview-only" };
    if (path === "/api/auth/webauthn/register/verify") {
      if (scenario === "retry" && state.attempts++ === 0) throw new Error("登録できませんでした");
      return { ok: true };
    }
    return undefined;
  },
};
