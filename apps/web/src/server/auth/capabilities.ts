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
  "can_dispatch", // 配車（シフトへの車両割当・貸出管理。貸出は can_manage_vehicles でも可）
  "can_view_rewards", // 報酬・給与の閲覧
  "can_manage_rewards", // 単価設定・給与締め
  "can_view_bank_accounts", // 口座情報の閲覧
  "can_view_pii", // 顔・免許の閲覧
  "can_view_vehicles", // 車両情報の閲覧
  "can_manage_vehicles", // 車両の登録・管理（シフト画面の貸出切替を含む）
  "can_view_vehicle_cost", // 車両の金額情報（購入費用・リース代・初期費用回収）の閲覧
  "can_view_billing", // 請求・取引先の閲覧
  "can_manage_billing", // 請求の確定・取引先編集
  "can_view_members", // ドライバー名簿の閲覧
  "can_approve_members", // 参加承認・本人確認
  "can_manage_members", // ロール変更・退会処理
  "can_view_org_settings", // フォーム/締切/コース等の設定の閲覧
  "can_manage_org_settings", // 設定全般の編集（下の領域別 capability をすべて含む）
  // 設定の領域別の編集権限（「コースだけ触らせたい」等に対応・2026-08-03）。
  // can_manage_org_settings を持つロールは以下をすべて持つ（CAPABILITY_IMPLIES で展開）。
  "can_manage_courses", // コース／単価表（コース・単価・便）
  "can_manage_carriers", // キャリア／フォーム設計（キャリア・報告項目）
  "can_manage_report_kinds", // 報告種別
  "can_manage_submit_screen", // 送信後画面
  "can_send_notifications", // 通知の一斉配信（LINE・アプリ内インボックス）
] as const;

export type Capability = (typeof CAPABILITIES)[number];

// ============================================================
// capability の含意（上位を持つなら下位も持つ）。
// 既存ロール（can_manage_org_settings 付き）を壊さずに領域別権限へ分割するための橋渡し。
// 解決時に resolveAuthz が展開するので、各ガードは領域別 capability だけを見ればよい。
// ============================================================
export const CAPABILITY_IMPLIES: Partial<Record<Capability, Capability[]>> = {
  can_manage_org_settings: [
    "can_view_org_settings",
    "can_manage_courses",
    "can_manage_carriers",
    "can_manage_report_kinds",
    "can_manage_submit_screen",
  ],
  // 領域別の編集を持つなら、設定画面自体は開ける必要がある
  can_manage_courses: ["can_view_org_settings"],
  can_manage_carriers: ["can_view_org_settings"],
  can_manage_report_kinds: ["can_view_org_settings"],
  can_manage_submit_screen: ["can_view_org_settings"],
};

/** 含意を再帰的に展開した capability 集合を返す（付与された束 → 実効的な束）。 */
export function expandCapabilities(granted: Iterable<Capability>): Set<Capability> {
  const out = new Set<Capability>();
  const stack = [...granted];
  while (stack.length) {
    const c = stack.pop()!;
    if (out.has(c)) continue;
    out.add(c);
    for (const implied of CAPABILITY_IMPLIES[c] ?? []) stack.push(implied);
  }
  return out;
}

// ============================================================
// own スコープ権限 — 「自分のリソースに対してだけ」行える操作のカタログ。
// 既存の can_*（org 全体 = any スコープ）とは独立の軸。
// 付与ルール: works_as_driver（ドライバーとして扱う）を持つメンバーに全 own 権限を
// 一括付与する（現状はロール別の細分化はしない。将来 role_capabilities への行追加や
// パスキー紐づけの個人グラントに正本を移せるよう、判定は checkPermission に集約）。
// ハコ虎AI（エージェント）は委任元の own 権限の範囲でのみツールを実行できる想定。
//   設計: docs/platform-design.md §2-6
// ============================================================

export const OWN_PERMISSIONS = [
  "own_submit_reports", // 自分の日報の送信・修正
  "own_manage_shift_requests", // 自分の希望休の提出・変更
  "own_view_shifts", // 自分のシフト・便の閲覧
  "own_view_rewards", // 自分の報酬の閲覧
  "own_manage_profile", // 自分のプロフィール・口座の管理
] as const;

export type OwnPermission = (typeof OWN_PERMISSIONS)[number];

// 権限設定 UI 用のメタ（日本語ラベル＋グループ）。チェックボックスをグループ表示するための情報。
export const CAPABILITY_GROUP_ORDER = [
  "日報",
  "シフト",
  "報酬",
  "車両",
  "請求",
  "本人確認・口座",
  "メンバー",
  "通知",
  "設定",
] as const;

export const CAPABILITY_META: Record<Capability, { label: string; group: (typeof CAPABILITY_GROUP_ORDER)[number] }> = {
  can_view_reports: { label: "日報の閲覧", group: "日報" },
  can_edit_reports: { label: "日報の代理入力・修正", group: "日報" },
  can_view_shifts: { label: "シフトの閲覧", group: "シフト" },
  can_manage_shifts: { label: "シフトの管理（確定・希望休）", group: "シフト" },
  can_dispatch: { label: "配車（車両割当）", group: "シフト" },
  can_view_rewards: { label: "報酬・給与の閲覧", group: "報酬" },
  can_manage_rewards: { label: "報酬の管理（単価・締め）", group: "報酬" },
  can_view_vehicles: { label: "車両の閲覧", group: "車両" },
  can_manage_vehicles: { label: "車両の管理", group: "車両" },
  can_view_vehicle_cost: { label: "車両の金額情報", group: "車両" },
  can_view_billing: { label: "請求・取引先の閲覧", group: "請求" },
  can_manage_billing: { label: "請求の管理（確定・取引先編集）", group: "請求" },
  can_view_bank_accounts: { label: "口座情報の閲覧", group: "本人確認・口座" },
  can_view_pii: { label: "顔・免許の閲覧", group: "本人確認・口座" },
  can_view_members: { label: "ドライバー名簿の閲覧", group: "メンバー" },
  can_approve_members: { label: "参加承認・本人確認", group: "メンバー" },
  can_manage_members: { label: "ロール変更・退会処理", group: "メンバー" },
  can_send_notifications: { label: "通知の一斉配信", group: "通知" },
  can_view_org_settings: { label: "設定の閲覧", group: "設定" },
  can_manage_org_settings: { label: "設定の編集（全領域）", group: "設定" },
  can_manage_courses: { label: "コース／単価表の編集", group: "設定" },
  can_manage_carriers: { label: "キャリア／フォーム設計の編集", group: "設定" },
  can_manage_report_kinds: { label: "報告種別の編集", group: "設定" },
  can_manage_submit_screen: { label: "送信後画面の編集", group: "設定" },
};

// ============================================================
// 権限設定 UI 用の行定義（Discord の権限上書き画面風）。
// 1行 = 1機能ドメイン。leveled は view/manage の capability ペアを
// 「許可なし / 閲覧のみ / 編集可能」の3択で設定し、binary は単一 capability の
// 「許可なし / 可能」2択。編集可能 = view + manage の両方を付与（編集は閲覧を含む）。
// ============================================================

export type PermissionRow =
  | {
      kind: "leveled";
      key: string;
      label: string;
      description: string;
      view: Capability;
      manage: Capability;
    }
  | {
      kind: "binary";
      key: string;
      label: string;
      description: string;
      capability: Capability;
      onLabel: string;
    };

export const PERMISSION_ROWS: PermissionRow[] = [
  {
    kind: "leveled",
    key: "reports",
    label: "日報",
    description: "全ドライバーの日報を閲覧できます。編集可能にすると代理入力・修正もできます。",
    view: "can_view_reports",
    manage: "can_edit_reports",
  },
  {
    kind: "leveled",
    key: "shifts",
    label: "シフト",
    description: "シフト表を閲覧できます。編集可能にするとシフト確定・希望休の管理もできます。",
    view: "can_view_shifts",
    manage: "can_manage_shifts",
  },
  {
    kind: "binary",
    key: "dispatch",
    label: "配車（車両割当）",
    description:
      "シフト表で車両の割当・貸出中の切替ができます。シフトの閲覧権限と合わせて付与してください。",
    capability: "can_dispatch",
    onLabel: "可能",
  },
  {
    kind: "leveled",
    key: "rewards",
    label: "報酬・給与",
    description: "報酬・給与を閲覧できます。編集可能にすると単価設定・給与締めもできます。",
    view: "can_view_rewards",
    manage: "can_manage_rewards",
  },
  {
    kind: "leveled",
    key: "vehicles",
    label: "車両",
    description:
      "車両情報を閲覧できます。編集可能にすると車両の登録・管理と、シフト画面での貸出中の切替もできます。",
    view: "can_view_vehicles",
    manage: "can_manage_vehicles",
  },
  {
    kind: "binary",
    key: "vehicle_cost",
    label: "車両の金額情報",
    description:
      "購入費用・リース代・保険料と初期費用の回収状況を閲覧できます。配車だけを担当する人には付けない運用ができます（編集は車両の管理権限が必要）。",
    capability: "can_view_vehicle_cost",
    onLabel: "閲覧可能",
  },
  {
    kind: "leveled",
    key: "billing",
    label: "請求・取引先",
    description: "請求・取引先を閲覧できます。編集可能にすると請求の確定・取引先の編集もできます。",
    view: "can_view_billing",
    manage: "can_manage_billing",
  },
  {
    kind: "leveled",
    key: "members",
    label: "ドライバー名簿",
    description: "メンバー名簿を閲覧できます。編集可能にするとロール変更・退会処理もできます。",
    view: "can_view_members",
    manage: "can_manage_members",
  },
  {
    kind: "binary",
    key: "approve_members",
    label: "参加承認・本人確認",
    description: "参加申請の承認と本人確認（KYC）を実施できます。",
    capability: "can_approve_members",
    onLabel: "可能",
  },
  {
    kind: "binary",
    key: "bank_accounts",
    label: "口座情報",
    description: "ドライバーの銀行口座情報を閲覧できます。",
    capability: "can_view_bank_accounts",
    onLabel: "閲覧可能",
  },
  {
    kind: "binary",
    key: "pii",
    label: "顔写真・免許証",
    description: "顔写真・運転免許証など本人確認書類を閲覧できます。",
    capability: "can_view_pii",
    onLabel: "閲覧可能",
  },
  {
    kind: "binary",
    key: "send_notifications",
    label: "通知の一斉配信",
    description:
      "ドライバーへの一斉連絡（LINE・アプリ内インボックス）を送信できます。送信先は自社のメンバーに限られます。",
    capability: "can_send_notifications",
    onLabel: "可能",
  },
  {
    kind: "leveled",
    key: "org_settings",
    label: "設定（全領域）",
    description:
      "フォーム・締切・コース等の設定を閲覧できます。「編集可能」は設定全般の編集（チーム戦・地図の拠点管理などを含む）で、下の領域別4つも自動で有効になります。特定の領域だけ任せたい場合は、ここは「閲覧のみ」にして下の領域別を使ってください。",
    view: "can_view_org_settings",
    manage: "can_manage_org_settings",
  },
  // 領域別の編集（「コースだけ任せたい」等）。設定の閲覧は自動で付く。
  {
    kind: "binary",
    key: "manage_courses",
    label: "コース／単価表の編集",
    description: "コース・単価表・便の追加や変更ができます。他の設定は閲覧のみになります。",
    capability: "can_manage_courses",
    onLabel: "編集可能",
  },
  {
    kind: "binary",
    key: "manage_carriers",
    label: "キャリア／フォーム設計の編集",
    description: "キャリアと日報フォーム（報告項目）の設計を変更できます。",
    capability: "can_manage_carriers",
    onLabel: "編集可能",
  },
  {
    kind: "binary",
    key: "manage_report_kinds",
    label: "報告種別の編集",
    description: "日報以外の報告種別（オイル交換など）の設定を変更できます。",
    capability: "can_manage_report_kinds",
    onLabel: "編集可能",
  },
  {
    kind: "binary",
    key: "manage_submit_screen",
    label: "送信後画面の編集",
    description: "日報送信後にドライバーへ表示する画面の内容を変更できます。",
    capability: "can_manage_submit_screen",
    onLabel: "編集可能",
  },
];

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
    "can_view_vehicle_cost", // 資産・コスト管理は経理の担当
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
