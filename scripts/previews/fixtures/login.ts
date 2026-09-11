import type { PreviewFixture } from "@/lib/preview/fixtureStore";

export const loginFixture: PreviewFixture<Record<string, never>> = {
  id: "login", title: "ログイン", pathname: "/login",
  scenarios: {
    normal: { label: "通常", description: "架空のPasskeyでログインする" },
    inactive: { label: "利用停止", description: "停止済みの人の再ログインを拒否する" },
    changed: { label: "権限変更後", description: "新しくログインすると利用を再開できる" },
  },
  createState: () => ({}),
  read: () => undefined,
  write: (_state, { path }, { scenario, driver }) => {
    if (path === "/api/auth/webauthn/login/options") return { options: {}, challengeToken: "preview-login" };
    if (path === "/api/auth/webauthn/login/verify" || path === "/api/auth/login") {
      if (scenario === "inactive") throw new Error("このアカウントは現在利用できません。運営にお問い合わせください");
      return { token: "preview-only-token", driver };
    }
    return undefined;
  },
};
