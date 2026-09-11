// 本番 /admin/account を再利用。端末認証とAPIは隔離runnerの中だけで模擬する。
import type { PreviewFixture } from "@/lib/preview/fixtureStore";

type State = { hasPasskey: boolean; attempts: number; tokens: Set<string> };

export const accountFixture: PreviewFixture<State> = {
  id: "account",
  title: "アカウント設定",
  pathname: "/admin/account",
  scenarios: {
    normal: { label: "登録済み", description: "架空のPasskeyを追加登録する" },
    empty: { label: "未登録", description: "初めての登録を試す" },
    expired: { label: "期限切れ", description: "最初の認証が期限切れになり、再試行で成功する" },
    used: { label: "使用済み", description: "最初の認証が使用済みで拒否され、再試行で成功する" },
    unavailable: { label: "認証保存失敗", description: "認証記録を保存できず、再試行で成功する" },
    inactive: { label: "利用停止", description: "画面を開いた後に停止。次の操作でログインへ戻り、再ログインも拒否される" },
    changed: { label: "権限変更", description: "画面を開いた後に権限変更。次の操作でログインへ戻る" },
  },
  createState: ({ scenario }) => ({ hasPasskey: scenario === "normal", attempts: 0, tokens: new Set() }),
  read: (state, { path }) => path === "/api/admin/account" ? { hasPasskey: state.hasPasskey } : undefined,
  write: (state, { path, body }, { scenario }) => {
    if (path === "/api/auth/webauthn/register/options") {
      if (scenario === "inactive" || scenario === "changed") {
        throw Object.assign(new Error("ログインし直してください"), { status: 401 });
      }
      const token = `preview-only-${state.attempts + 1}`;
      state.tokens.add(token);
      return { options: {}, challengeToken: token };
    }
    if (path === "/api/auth/webauthn/register/verify") {
      state.attempts += 1;
      const token = String(body.challengeToken);
      if (!state.tokens.delete(token) || (scenario === "used" && state.attempts === 1)) {
        throw new Error("認証をやり直してください。もう一度Passkeyを登録できます");
      }
      if (scenario === "expired" && state.attempts === 1) {
        throw new Error("セッションの有効期限が切れました。もう一度お試しください");
      }
      if (scenario === "unavailable" && state.attempts === 1) {
        throw new Error("認証を完了できませんでした。時間をおいてもう一度お試しください");
      }
      state.hasPasskey = true;
      return { ok: true };
    }
    return undefined;
  },
};
