// 未確認だった本番ページの読み込み表示を、架空データだけで監査するfixture。
// loadingは全取得、detail-loadingは一覧から開く詳細だけを待機させる。
import type { PreviewFixture } from "@/lib/preview/fixtureStore";

const scenarios = {
  normal: { label: "通常", description: "架空データの通常表示" },
  empty: { label: "対象なし", description: "架空データなし" },
};
const carrier = { id: "carrier-preview", name: "見本配送", code: "SAMPLE", active: true, sort_order: 0, units: [{ id: "unit-preview", carrier_id: "carrier-preview", name: "宅配", code: "DELIVERY", billing_type: "PER_PIECE", active: true, sort_order: 0, fields: [{ id: "field-preview", unit_id: "unit-preview", field_key: "completed", label: "完了個数", input_type: "INT", group_label: null, is_billable: true, required: true, sort_order: 0 }] }] };
const event = { id: "event-preview", name: "見本イベント", description: "", starts_on: "2026-11-01", ends_on: "2026-11-30", status: "active", created_at: "2026-11-01T00:00:00Z", scoring_rule: { version: 1, rules: [] } };
const notificationSettings = { assignmentEnabled: false, assignmentSendAt: "18:00", assignmentIncludeMeeting: false, assignmentIncludeVehicle: false, restDayEnabled: false, changeEnabled: false, lineMonthlyLimit: null };

export const carriersFixture: PreviewFixture<null> = {
  id: "carriers", title: "キャリア", pathname: "/admin/carriers", scenarios,
  createState: () => null,
  read: (_state, { path }, { scenario }) => path === "/api/admin/carriers" ? { carriers: scenario === "empty" ? [] : [carrier] } : path === "/api/admin/report-image-templates" ? { templates: [] } : undefined,
};
export const deliveryFixture: PreviewFixture<null> = {
  id: "delivery", title: "配達実績", pathname: "/admin/delivery", scenarios,
  createState: () => null,
  read: (_state, { path }) => path === "/api/admin/reports-summary" ? { units: [], byDriver: {}, byDate: {}, byCourse: {}, workDaysByDriver: {}, courses: [], drivers: [] } : undefined,
};
export const eventsFixture: PreviewFixture<null> = {
  id: "events", title: "イベント", pathname: "/admin/events",
  scenarios: { ...scenarios, "detail-loading": { label: "詳細の読み込み中" }, "ranking-loading": { label: "ランキングの読み込み中" } },
  createState: () => null,
  isPending: (_state, { path }, { scenario }) => scenario === "detail-loading" ? path === "/api/admin/events/event-preview" : scenario === "ranking-loading" && /\/events\/event-preview\/(ranking|points)$/.test(path),
  read: (_state, { path }, { scenario }) => {
    if (path === "/api/admin/events") return { events: scenario === "empty" ? [] : [event] };
    if (path === "/api/admin/carriers") return { carriers: [carrier] };
    if (path === "/api/admin/events/event-preview") return { event, teams: [], members: [], drivers: [] };
    if (path.endsWith("/ranking")) return { teams: [], individuals: [], driverNames: {} };
    if (path.endsWith("/points")) return { entries: [] };
    return undefined;
  },
};
export const notificationsFixture: PreviewFixture<null> = {
  id: "notifications", title: "通知", pathname: "/admin/notifications",
  scenarios: { ...scenarios, "chat-loading": { label: "会話の読み込み中" } },
  createState: () => null,
  isPending: (_state, { path }, { scenario }) => scenario === "chat-loading" && path === "/api/admin/notifications/chats/driver-preview",
  read: (_state, { path }, { scenario }) => {
    if (path === "/api/admin/notifications") return { lineConfigured: false, members: [], linkedCount: 0, recentBroadcasts: [] };
    if (path === "/api/admin/notifications/chats") return { threads: scenario === "empty" ? [] : [{ driverId: "driver-preview", name: "見本 太郎", blocked: false, lastMessage: "見本の会話", lastDirection: "outbound", lastAt: "2026-11-17T01:00:00Z", unreadCount: 0 }], totalUnread: 0 };
    if (path === "/api/admin/notifications/chats/driver-preview") return { driver: { id: "driver-preview", name: "見本 太郎", blocked: false }, messages: [] };
    if (path === "/api/admin/notifications/settings") return { settings: notificationSettings };
    if (path === "/api/admin/notifications/quota") return { configured: false, scope: null, quota: null };
    if (path.startsWith("/api/admin/notifications/")) return { items: [] };
    return undefined;
  },
};
export const driverNotificationsFixture: PreviewFixture<null> = {
  id: "driver-notifications", title: "お知らせ", pathname: "/notifications", scenarios,
  createState: () => null,
  read: (_state, { path }, { scenario }) => {
    if (path === "/api/me/notifications") return { notifications: scenario === "empty" ? [] : [{ id: "notice-preview", kind: "broadcast", title: "見本のお知らせ", body: "架空の通知本文", read_at: null, created_at: "2026-11-17T01:00:00Z" }], unreadCount: scenario === "empty" ? 0 : 1 };
    if (path === "/api/me/line") return { configured: false, linked: false };
    return undefined;
  },
};
export const rewardsFixture: PreviewFixture<null> = {
  id: "rewards", title: "報酬", pathname: "/me/rewards", scenarios,
  createState: () => null,
  read: (_state, { path, params }) => {
    if (path === "/api/me/rewards") return { month: params.get("month"), startDate: "2026-11-01", endDate: "2026-11-30", incomeLog: 0, variableDeductions: 0, fixedDeductions: 0, optionalDeductions: 0, leaseDeductions: 0, net: 0, logDetails: [], dailyIncomeDetails: [], fixedDetails: [], optionalDetails: [] };
    if (path === "/api/me/invoices") return { invoices: [] };
    return undefined;
  },
};
export const adjustmentsFixture: PreviewFixture<null> = {
  id: "adjustments", title: "調整履歴", pathname: "/admin/adjustments", scenarios,
  createState: () => null,
  read: (_state, { path }) => path === "/api/admin/sales/log" ? { entries: [] } : undefined,
};
export const submitScreenFixture: PreviewFixture<null> = {
  id: "submit-screen", title: "送信後の画面", pathname: "/admin/submit-screen", scenarios,
  createState: () => null,
  read: (_state, { path }) => path === "/api/admin/submit-screen" ? { config: { blocks: [] }, drivers: [], carriers: [], events: [] } : undefined,
};

// スケルトンを使わない待機表示も、同じ隔離環境で確認する。
export const utilityLoadingFixture: PreviewFixture<null> = {
  id: "utility-loading", title: "補助ページ", pathname: "/admin/attendance", scenarios,
  createState: () => null,
  read: (_state, { path, params }) => {
    if (path === "/api/admin/attendance") return { items: [] };
    if (path === "/api/admin/counterparties/summary") return { month: params.get("month"), rows: [] };
    if (path === "/api/admin/invoice-addresses") return { addresses: [] };
    if (path === "/api/record-forms") return { actor: { id: "preview-actor", name: "見本 太郎" }, canConfigure: false, forms: [], grants: {}, roles: [], members: [] };
    if (path === "/api/admin/report-kinds") return { kinds: [] };
    if (path === "/api/admin/misc-reports/oil-change") return { entries: [], nextCursor: null, hasMore: false };
    if (path === "/api/platform/orgs") return { orgs: [] };
    if (path === "/api/platform/applications") return { applications: [] };
    return undefined;
  },
};
