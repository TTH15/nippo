import type { PreviewFixture } from "@/lib/preview/fixtureStore";

type Driver = { id: string; name: string; nameKana: string; phone: null; status: string; created_at: null };
type Invite = { id: string; name: string; token: string; status: string; createdAt: string; expiresAt: string };
type State = { drivers: Driver[]; invites: Invite[] };

// 本番の参加承認ページを再利用。架空の申請と招待だけで表示・操作を確認する。
export const usersPendingFixture: PreviewFixture<State> = {
  id: "users-pending", title: "参加承認", pathname: "/admin/users/pending",
  scenarios: {
    normal: { label: "通常", description: "架空の参加申請" },
    empty: { label: "申請なし", description: "申請・招待のない状態" },
    "long-name": { label: "長い名前", description: "長い名前の表示" },
  },
  createState: ({ scenario }) => ({ drivers: scenario === "empty" ? [] : ["申請サンプル 一郎", "申請サンプル 二郎"].map((name, i) => ({
    id: `pending-${i}`, name: scenario === "long-name" ? `${name}・長い表示名の確認用` : name,
    nameKana: "シンセイサンプル", phone: null, status: "pending", created_at: null,
  })), invites: [] }),
  read: (state, { path, params }) => {
    if (path === "/api/admin/users") return { drivers: params.get("stage") === "kyc" ? [] : state.drivers, total: state.drivers.length };
    if (path === "/api/admin/courses") return { courses: [] };
    if (path === "/api/admin/invites") return { invites: state.invites };
    return undefined;
  },
  write: (state, { path, method, body }, { role }) => {
    if (role !== "admin") throw new Error("権限がありません");
    const driverId = path.match(/^\/api\/admin\/users\/([^/]+)$/)?.[1];
    if (driverId && ["PUT", "DELETE"].includes(method)) { state.drivers = state.drivers.filter(d => d.id !== driverId); return { ok: true }; }
    if (path === "/api/admin/invites" && method === "POST") {
      const invite = { id: `invite-${state.invites.length}`, name: String(body.name ?? "サンプル"), token: `preview-only-${state.invites.length}`, status: "active", createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 7 * 86400_000).toISOString() };
      state.invites.push(invite); return { invite };
    }
    const inviteId = path.match(/^\/api\/admin\/invites\/([^/]+)$/)?.[1];
    if (inviteId && method === "DELETE") { state.invites = state.invites.filter(i => i.id !== inviteId); return { ok: true }; }
    return undefined;
  },
};
