// 本番 /admin/account を再利用。端末認証とAPIは隔離runnerの中だけで模擬する。
import type { PreviewFixture } from "@/lib/preview/fixtureStore";

type State = { hasPasskey: boolean; attempts: number; tokens: Set<string>; verified: boolean; keys: { id: string; name: string; created_at: string; last_used_at: null }[] };

export const accountFixture: PreviewFixture<State> = {
  id: "account",
  title: "アカウント設定",
  pathname: "/admin/account",
  scenarios: {
    nofactor: { label: "確認方法なし", description: "登録済みの確認方法がなく運営へ案内" },
    lastkey: { label: "最後の鍵", description: "SMS未確認の場合、最後の鍵は削除できない" },
    normal: { label: "登録済み", description: "架空のPasskeyを追加登録する" },
    empty: { label: "未登録", description: "初めての登録を試す" },
    expired: { label: "期限切れ", description: "最初の認証が期限切れになり、再試行で成功する" },
    used: { label: "使用済み", description: "最初の認証が使用済みで拒否され、再試行で成功する" },
    unavailable: { label: "認証保存失敗", description: "認証記録を保存できず、再試行で成功する" },
    inactive: { label: "利用停止", description: "画面を開いた後に停止。次の操作でログインへ戻り、再ログインも拒否される" },
    changed: { label: "権限変更", description: "画面を開いた後に権限変更。次の操作でログインへ戻る" },
  },
  createState: ({ scenario }) => ({ hasPasskey: scenario === "normal", attempts: 0, tokens: new Set(), verified: false,
    keys: ["normal", "lastkey"].includes(scenario) ? [{ id: "00000000-0000-0000-0000-000000000001", name: "普段の端末", created_at: "2026-09-16T03:00:00Z", last_used_at: null }] : [] }),
  read: (state, { path }, { scenario }) => {
    if (path === "/api/admin/account") return { hasPasskey: state.hasPasskey };
    if (path === "/api/me/passkeys") return { keys: state.keys, canRecoverWithSms: !["lastkey", "nofactor"].includes(scenario) };
    if (path === "/api/auth/reauth") return { recent: state.verified, canUseSms: !["lastkey", "nofactor"].includes(scenario), phoneMasked: "下4桁 0000", hasPasskey: state.keys.length > 0 };
    return undefined;
  },
  write: (state, { path, body, method }, { scenario }) => {
    if (path === "/api/auth/reauth/options") return { options: {}, challengeToken: "preview-reauth" };
    if (path === "/api/auth/reauth/verify") {
      if (body.method === "sms" && body.code !== "123456") throw new Error("認証コードが正しくありません");
      state.verified = true; return { reauthToken: "preview-reauth-proof" };
    }
    if (path === "/api/me/passkeys" && method === "DELETE") {
      state.keys = state.keys.filter((key) => key.id !== body.id); state.hasPasskey = state.keys.length > 0; return { ok: true };
    }
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
      state.keys.push({ id: `00000000-0000-0000-0000-${String(state.attempts + 1).padStart(12, "0")}`, name: "追加した端末", created_at: "2026-09-17T03:00:00Z", last_used_at: null });
      state.hasPasskey = true;
      return { ok: true };
    }
    return undefined;
  },
};
