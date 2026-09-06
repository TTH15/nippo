// ============================================================
// ログイン不要プレビューの「状態をURLで作る」ための純粋ロジック。
// `?scenario=` で画面のデータ状態、`?role=` で閲覧者の権限を切り替える。
// 本番の認証・API・DBには一切触れない（スタンドアロンの runner だけが使う）。
// ============================================================

export type PreviewRole = "admin" | "accounting" | "viewer";

export type PreviewRoleDefinition = {
  /** UI表示名 */
  label: string;
  /** StoredDriver.role に入れる値（本番のプリセットロール名と一致させる） */
  role: string;
  /** StoredDriver.capabilities に入れる束（src/server/auth/capabilities.ts の DEFAULT_ROLE_CAPABILITIES を写す） */
  capabilities: string[];
};

const ALL_CAPABILITIES = [
  "can_access_records", "can_approve_members", "can_dispatch", "can_edit_reports",
  "can_manage_billing", "can_manage_carriers", "can_manage_courses", "can_manage_members",
  "can_manage_org_settings", "can_manage_record_forms", "can_manage_report_kinds", "can_manage_rewards",
  "can_manage_shifts", "can_manage_submit_screen", "can_manage_vehicles", "can_send_notifications",
  "can_view_bank_accounts", "can_view_billing", "can_view_members", "can_view_org_settings",
  "can_view_pii", "can_view_reports", "can_view_rewards", "can_view_shifts",
  "can_view_vehicle_cost", "can_view_vehicles",
];

export const PREVIEW_ROLES: Record<PreviewRole, PreviewRoleDefinition> = {
  admin: { label: "管理者", role: "ADMIN", capabilities: ALL_CAPABILITIES },
  accounting: {
    label: "経理",
    role: "ACCOUNTING",
    capabilities: [
      "can_view_reports", "can_view_shifts", "can_view_rewards", "can_manage_rewards",
      "can_view_bank_accounts", "can_view_vehicles", "can_view_vehicle_cost", "can_view_billing",
      "can_manage_billing", "can_view_members", "can_view_org_settings",
    ],
  },
  viewer: {
    label: "閲覧のみ",
    role: "ADMIN_VIEWER",
    capabilities: [
      "can_view_reports", "can_view_shifts", "can_view_rewards", "can_view_vehicles",
      "can_view_billing", "can_view_members", "can_view_org_settings",
    ],
  },
};

export const PREVIEW_ROLE_ORDER: PreviewRole[] = ["admin", "accounting", "viewer"];

export const DEFAULT_SCENARIO = "normal";
export const DEFAULT_ROLE: PreviewRole = "admin";

/**
 * すべてのfixtureが共通で解釈するシナリオ。
 * loading / error はデータを持たず、ストア側で「取得中のまま」「取得失敗」を再現する。
 */
export const BUILTIN_SCENARIOS = {
  loading: { label: "読み込み中", description: "取得が終わらない。スケルトンの見た目を確認する" },
  error: { label: "取得エラー", description: "すべての取得が失敗する。エラー表示と再試行を確認する" },
} as const;

export type ScenarioDefinition = { label: string; description?: string };

export type PreviewLocation = { scenario: string; role: PreviewRole };

const SCENARIO_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export function isPreviewRole(value: string | null | undefined): value is PreviewRole {
  return value === "admin" || value === "accounting" || value === "viewer";
}

/** `?scenario=empty&role=viewer` を読む。不正値は既定に倒す（URLを手で打っても壊れない）。 */
export function parsePreviewLocation(search: string): PreviewLocation {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const rawScenario = params.get("scenario")?.trim() ?? "";
  const scenario = SCENARIO_PATTERN.test(rawScenario) ? rawScenario : DEFAULT_SCENARIO;
  const rawRole = params.get("role")?.trim();
  const role = isPreviewRole(rawRole) ? rawRole : DEFAULT_ROLE;
  return { scenario, role };
}

/** 既定値は省略し、指定があるものだけをクエリに残す。既存のクエリ（期間など）は保持する。 */
export function buildPreviewHref(pathname: string, location: Partial<PreviewLocation>, currentSearch = ""): string {
  const [path, existing = ""] = pathname.split("?");
  const params = new URLSearchParams(existing || (currentSearch.startsWith("?") ? currentSearch.slice(1) : currentSearch));
  params.delete("scenario");
  params.delete("role");
  if (location.scenario && location.scenario !== DEFAULT_SCENARIO) params.set("scenario", location.scenario);
  if (location.role && location.role !== DEFAULT_ROLE) params.set("role", location.role);
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

/** 役割に応じた StoredDriver 相当の値。 */
export function previewDriverFor(role: PreviewRole) {
  const definition = PREVIEW_ROLES[role];
  return {
    id: `preview-${role}`,
    name: `サンプル${definition.label}`,
    role: definition.role,
    companyCode: "DEFAULT",
    capabilities: [...definition.capabilities],
  };
}
