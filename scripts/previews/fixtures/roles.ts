import type { PreviewFixture } from "@/lib/preview/fixtureStore";
import roleCatalog from "@/lib/roleCatalog.json";

type Role = { id: string; key: string; label: string; isSystem: boolean; sortOrder: number; capabilities: string[] };
type Member = { id: string; name: string; roleId: string; worksAsDriver: boolean };
type State = { roles: Role[]; members: Member[] };

const seedRoles = (): Role[] => [
  { id: "role-admin", key: "ADMIN", label: "管理者", isSystem: true, sortOrder: 0, capabilities: [...roleCatalog.capabilities] },
  { id: "role-accounting", key: "ACCOUNTING", label: "経理", isSystem: true, sortOrder: 10, capabilities: [...roleCatalog.defaultRoleCapabilities.ACCOUNTING] },
  { id: "role-viewer", key: "ADMIN_VIEWER", label: "閲覧者", isSystem: true, sortOrder: 20, capabilities: [...roleCatalog.defaultRoleCapabilities.ADMIN_VIEWER] },
  { id: "role-driver", key: "DRIVER", label: "ドライバー", isSystem: true, sortOrder: 30, capabilities: [] },
];

export const rolesFixture: PreviewFixture<State> = {
  id: "roles",
  title: "ロール・権限",
  pathname: "/admin/roles",
  scenarios: {
    normal: { label: "通常", description: "4つの既定ロールと架空メンバー" },
    empty: { label: "メンバーなし", description: "メンバー割当が空" },
  },
  createState: ({ scenario }) => ({
    roles: seedRoles(),
    members: scenario === "empty" ? [] : [
      { id: "member-1", name: "佐藤 翔太", roleId: "role-admin", worksAsDriver: true },
      { id: "member-2", name: "田中 美咲", roleId: "role-accounting", worksAsDriver: false },
      { id: "member-3", name: "鈴木 大輔", roleId: "role-driver", worksAsDriver: true },
    ],
  }),
  read: (state, { path }) => path === "/api/admin/roles" ? { ...state, rows: roleCatalog.permissionRows } : undefined,
  write: (state, { path, method, body }) => {
    if (path === "/api/admin/roles" && method === "POST") {
      const role: Role = { id: `role-${state.roles.length + 1}`, key: `CUSTOM_${state.roles.length + 1}`, label: String(body.label ?? "新規ロール"), isSystem: false, sortOrder: state.roles.length * 10, capabilities: Array.isArray(body.capabilities) ? body.capabilities as string[] : [] };
      state.roles.push(role);
      return { id: role.id };
    }
    if (path === "/api/admin/roles" && method === "PATCH") {
      const order = Array.isArray(body.order) ? body.order : [];
      state.roles.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
      return { ok: true };
    }
    const roleId = path.match(/^\/api\/admin\/roles\/([^/]+)$/)?.[1];
    if (roleId && method === "PATCH") {
      const role = state.roles.find((item) => item.id === roleId);
      if (!role) return undefined;
      if (Array.isArray(body.capabilities)) role.capabilities = body.capabilities as string[];
      return { ok: true };
    }
    if (roleId && method === "DELETE") {
      state.roles = state.roles.filter((item) => item.id !== roleId);
      return { ok: true };
    }
    const memberId = path.match(/^\/api\/admin\/users\/([^/]+)$/)?.[1];
    if (memberId && method === "PUT") {
      const member = state.members.find((item) => item.id === memberId);
      if (!member) return undefined;
      if (typeof body.roleId === "string") member.roleId = body.roleId;
      if (typeof body.worksAsDriver === "boolean") member.worksAsDriver = body.worksAsDriver;
      return { ok: true };
    }
    return undefined;
  },
};
