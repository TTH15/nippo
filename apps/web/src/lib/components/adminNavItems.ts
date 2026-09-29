import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import {
  faAddressBook,
  faBell,
  faBoxesStacked,
  faBriefcase,
  faBuilding,
  faCalendar,
  faCar,
  faChartColumn,
  faChartLine,
  faClock,
  faFileInvoice,
  faFileLines,
  faGear,
  faImage,
  faListUl,
  faMobileScreenButton,
  faMoneyBill1Wave,
  faRoute,
  faTrophy,
  faTruck,
  faUserPlus,
  faUserShield,
  faUsers,
} from "@fortawesome/free-solid-svg-icons";

// 各リンクのcapは対象ページの主要APIの閲覧権限と揃える。
export type NavChild = { href: string; label: string; icon?: IconDefinition; cap?: string; beta?: boolean };
export type NavItem =
  | { href: string; label: string; icon?: IconDefinition; cap?: string; beta?: boolean; children?: undefined }
  | { label: string; icon?: IconDefinition; children: NavChild[]; href?: undefined; cap?: undefined; beta?: undefined };

export const adminNavItems: NavItem[] = [
  { href: "/admin", label: "ダッシュボード", icon: faChartLine },
  {
    label: "シフト", icon: faCalendar, children: [
      { href: "/admin/shifts", label: "シフト", icon: faCalendar, cap: "can_view_shifts" },
      { href: "/admin/spot-jobs", label: "単発案件", icon: faBriefcase, cap: "can_view_shifts", beta: true },
    ],
  },
  {
    label: "ドライバー", icon: faUsers, children: [
      { href: "/admin/users", label: "ドライバー一覧", icon: faUsers, cap: "can_view_members" },
      { href: "/admin/users/pending", label: "参加・承認", icon: faUserPlus, cap: "can_approve_members" },
      { href: "/admin/attendance", label: "勤怠", icon: faClock, cap: "can_view_vehicles", beta: true },
    ],
  },
  {
    label: "車両", icon: faCar, children: [
      { href: "/admin/vehicles", label: "車両一覧", icon: faCar, cap: "can_view_vehicles" },
    ],
  },
  {
    label: "報告", icon: faFileLines, children: [
      { href: "/admin/daily", label: "日報", icon: faFileLines, cap: "can_view_reports" },
      { href: "/admin/records", label: "記録・報告", icon: faFileLines, cap: "can_access_records" },
      { href: "/admin/report-images", label: "画像の確認", icon: faImage, cap: "can_view_reports", beta: true },
      { href: "/admin/delivery", label: "配達実績", icon: faBoxesStacked, cap: "can_view_reports" },
    ],
  },
  {
    label: "収支", icon: faFileInvoice, children: [
      { href: "/admin/sales", label: "売上", icon: faChartColumn, cap: "can_view_billing" },
      { href: "/admin/payments", label: "ペイメント", icon: faMoneyBill1Wave, cap: "can_view_rewards" },
      { href: "/admin/invoices", label: "請求書", icon: faAddressBook, cap: "can_view_billing" },
      { href: "/admin/counterparties", label: "取引先", icon: faBuilding, cap: "can_view_billing" },
      { href: "/admin/adjustments", label: "調整履歴", icon: faListUl, cap: "can_view_billing" },
    ],
  },
  {
    label: "連絡", icon: faBell, children: [
      { href: "/admin/events", label: "イベント", icon: faTrophy, cap: "can_view_org_settings" },
      { href: "/admin/notifications", label: "通知配信", icon: faBell, cap: "can_send_notifications", beta: true },
    ],
  },
  {
    label: "設定", icon: faGear, children: [
      { href: "/admin/organization", label: "会社設定", icon: faBuilding, cap: "can_view_org_settings" },
      { href: "/admin/roles", label: "ロール・権限", icon: faUserShield, cap: "can_view_members" },
      { href: "/admin/carriers", label: "キャリア／フォーム設計", icon: faTruck, cap: "can_view_org_settings" },
      { href: "/admin/courses", label: "コース／単価表", icon: faRoute, cap: "can_view_org_settings" },
      { href: "/admin/record-forms", label: "フォーム管理", icon: faFileLines, cap: "can_manage_record_forms" },
      { href: "/admin/report-kinds", label: "報告種別", icon: faFileLines, cap: "can_view_org_settings" },
      { href: "/admin/submit-screen", label: "送信後画面", icon: faMobileScreenButton, cap: "can_view_org_settings" },
    ],
  },
];

const navLinks = adminNavItems.flatMap((item) => item.children ?? [item]);

export function activeAdminNavHref(pathname: string): string | null {
  return navLinks
    .filter((item) => pathname === item.href || item.href !== "/admin" && pathname.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href ?? null;
}
