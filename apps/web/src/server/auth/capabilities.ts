// ============================================================
// 認可モデル — capability カタログ（コードが知る固定集合）。
// 各 capability は1つのサーバーガード（requirePermission）に対応する。
// 新 capability の追加＝コード変更。org は capability を増やせない（role の束ね方だけ調整可）。
//   設計: docs/platform-design.md §2-6
// ============================================================

export const CAPABILITIES = [
  "can_view_reports", // 全員の日報を閲覧
  "can_edit_reports", // 代理入力・修正
  "can_view_shifts", // シフト表の閲覧
  "can_manage_shifts", // シフト確定・希望休管理
  "can_view_rewards", // 報酬・給与の閲覧
  "can_manage_rewards", // 単価設定・給与締め
  "can_view_bank_accounts", // 口座情報の閲覧
  "can_view_pii", // 顔・免許の閲覧
  "can_view_vehicles", // 車両情報の閲覧
  "can_manage_vehicles", // 車両の登録・管理
  "can_view_billing", // 請求・取引先の閲覧
  "can_manage_billing", // 請求の確定・取引先編集
  "can_view_members", // ドライバー名簿の閲覧
  "can_approve_members", // 参加承認・本人確認
  "can_manage_members", // ロール変更・退会処理
  "can_view_org_settings", // フォーム/締切/コース等の設定の閲覧
  "can_manage_org_settings", // フォーム/締切/コース等の設定の編集
] as const;

export type Capability = (typeof CAPABILITIES)[number];

// 権限設定 UI 用のメタ（日本語ラベル＋グループ）。チェックボックスをグループ表示するための情報。
export const CAPABILITY_GROUP_ORDER = [
  "日報",
  "シフト",
  "報酬",
  "車両",
  "請求",
  "本人確認・口座",
  "メンバー",
  "設定",
] as const;

export const CAPABILITY_META: Record<Capability, { label: string; group: (typeof CAPABILITY_GROUP_ORDER)[number] }> = {
  can_view_reports: { label: "日報の閲覧", group: "日報" },
  can_edit_reports: { label: "日報の代理入力・修正", group: "日報" },
  can_view_shifts: { label: "シフトの閲覧", group: "シフト" },
  can_manage_shifts: { label: "シフトの管理（確定・希望休）", group: "シフト" },
  can_view_rewards: { label: "報酬・給与の閲覧", group: "報酬" },
  can_manage_rewards: { label: "報酬の管理（単価・締め）", group: "報酬" },
  can_view_vehicles: { label: "車両の閲覧", group: "車両" },
  can_manage_vehicles: { label: "車両の管理", group: "車両" },
  can_view_billing: { label: "請求・取引先の閲覧", group: "請求" },
  can_manage_billing: { label: "請求の管理（確定・取引先編集）", group: "請求" },
  can_view_bank_accounts: { label: "口座情報の閲覧", group: "本人確認・口座" },
  can_view_pii: { label: "顔・免許の閲覧", group: "本人確認・口座" },
  can_view_members: { label: "ドライバー名簿の閲覧", group: "メンバー" },
  can_approve_members: { label: "参加承認・本人確認", group: "メンバー" },
  can_manage_members: { label: "ロール変更・退会処理", group: "メンバー" },
  can_view_org_settings: { label: "設定の閲覧", group: "設定" },
  can_manage_org_settings: { label: "設定の編集", group: "設定" },
};

// system 既定ロールの capability 束（migration 092 の seed と一致させること）。
// role_id 未解決（旧データ等）のフォールバックに使う。値の正本は role_capabilities テーブル。
export const DEFAULT_ROLE_CAPABILITIES: Record<string, Capability[]> = {
  ADMIN: [...CAPABILITIES],
  ACCOUNTING: [
    "can_view_reports",
    "can_view_shifts",
    "can_view_rewards",
    "can_manage_rewards",
    "can_view_bank_accounts",
    "can_view_vehicles",
    "can_view_billing",
    "can_manage_billing",
    "can_view_members",
    "can_view_org_settings",
  ],
  ADMIN_VIEWER: [
    "can_view_reports",
    "can_view_shifts",
    "can_view_rewards",
    "can_view_vehicles",
    "can_view_billing",
    "can_view_members",
    "can_view_org_settings",
  ],
  DRIVER: [],
};
