import type { PreviewFixture } from "@/lib/preview/fixtureStore";

export const loginFixture: PreviewFixture<Record<string, never>> = {
  id: "login", title: "ログイン入口", pathname: "/login",
  scenarios: {
    normal: { label: "通常", description: "架空のかんたんログインを使う" },
    inactive: { label: "利用停止", description: "停止済みの人の再ログインを拒否する" },
    "no-access": { label: "運営権限なし", description: "パスキーを確認できても運営画面には進めない" },
    changed: { label: "権限変更後", description: "新しくログインすると利用を再開できる" },
    pinless: { label: "招待ユーザー", description: "PIN欄を表示せず、かんたんログインとSMSを案内する" },
  },
  createState: () => ({}),
  read: () => undefined,
  write: (_state, { path }, { scenario, driver }) => {
    if (path === "/api/auth/webauthn/login/options") return { options: {}, challengeToken: "preview-login" };
    if (path === "/api/auth/webauthn/login/verify") {
      if (scenario === "inactive") throw new Error("このアカウントは現在利用できません。運営にお問い合わせください");
      const signedInDriver = scenario === "no-access" ? { ...driver, capabilities: [] } : driver;
      return { token: "preview-only-token", adminToken: signedInDriver.capabilities?.length ? "preview-only-admin-token" : null, driver: signedInDriver };
    }
    return undefined;
  },
};
