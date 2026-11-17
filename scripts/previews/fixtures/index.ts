import SalesPage from "@/app/(admin)/admin/(analytics)/sales/page";
import { salesFixture } from "./sales";
import InvoicePreviewPage from "@/app/(admin)/admin/(accounting)/invoices/[id]/preview/page";
import InvoiceEditPage from "@/app/(admin)/admin/(accounting)/invoices/[id]/edit/page";
import InvoiceListPage from "@/app/(admin)/admin/(accounting)/invoices/page";
import InvoiceNewPage from "@/app/(admin)/admin/(accounting)/invoices/new/page";
import { invoicePreviewFixture, invoiceEditFixture, invoiceListFixture, invoiceNewFixture, individualInvoicePreviewFixture, individualInvoiceEditFixture } from "./invoices";
import ReportKindsPage from "@/app/(admin)/admin/report-kinds/page";
import ReportImageTemplatesPage from "@/app/(admin)/admin/(settings)/report-image-templates/page";
import AdminDailyPage from "@/app/(admin)/admin/(ops)/daily/page";
import { dailyFixture } from "./daily";
import ReportImagesPage from "@/app/(admin)/admin/(ops)/report-images/page";
import { reportImagesFixture } from "./reportImages";
import { reportImageTemplatesFixture } from "./reportImageTemplates";
import { reportKindsFixture } from "./reportKinds";
// プレビューで開ける本番ページの登録表。1ページ = 本番の page.tsx + fixture。
// 追加するときはここに1行足し、docs/development/preview-workflow.md の一覧も更新する。
import type { ComponentType } from "react";
import type { PreviewFixture } from "@/lib/preview/fixtureStore";
import DashboardPage from "@/app/(admin)/admin/page";
import VehiclesPage from "@/app/(admin)/admin/(resource)/vehicles/page";
import BankCleanupPage from "../bank-cleanup";
import { bankCleanupFixture } from "./bankCleanup";
import UsersPage from "@/app/(admin)/admin/(resource)/users/page";
import UsersPendingPage from "@/app/(admin)/admin/(resource)/users/pending/page";
import { usersPendingFixture } from "./usersPending";
import CoursesPage from "@/app/(admin)/admin/(delivery)/courses/page";
import MapPage from "@/app/(admin)/admin/(ops)/map/page";
import PaymentsPage from "@/app/(admin)/admin/(accounting)/payments/page";
import SubmitPage from "../submit";
import MyShiftsPage from "../my-shifts";
import AccountPage from "@/app/(admin)/admin/account/page";
import LoginPreview from "../login";
import BankChangePreview from "../bank-change";
import OnboardingPreview from "../onboarding";
import RecoverPreview from "../recover";
import DriverSetupPreview from "../driver-setup";
import DriverSetupDesigns from "../driver-setup-designs";
import MePreview from "../me";
import ReportPreview from "../report";
import { reportFixture } from "./report";
import { recoverFixture } from "./recover";
import { meFixture } from "./me";
import { onboardingFixture } from "./onboarding";
import { dashboardFixture } from "./dashboard";
import { vehiclesFixture } from "./vehicles";
import { usersFixture } from "./users";
import { coursesFixture } from "./courses";
import RolesPage from "@/app/(admin)/admin/(resource)/roles/page";
import { rolesFixture } from "./roles";
import { mapFixture } from "./map";
import { paymentsFixture } from "./payments";
import { submitFixture } from "./submit";
import { myShiftsFixture } from "./myShifts";
import PlatformRecoveryPreview from "../platform-recovery";
import { platformRecoveryFixture } from "./platformRecovery";
import { accountFixture } from "./account";
import { loginFixture } from "./login";
import ShiftMemosPage from "@/app/(admin)/admin/(ops)/shift-memos/page";
import ShiftsPage from "@/app/(admin)/admin/(ops)/shifts/page";
import { shiftsFixture } from "./shifts";
import SpotJobsPage from "@/app/(admin)/admin/(ops)/spot-jobs/page";
import { spotJobsFixture } from "./spotJobs";
import OrganizationPage from "@/app/(admin)/admin/(settings)/organization/page";
import { organizationFixture } from "./organization";
import CarriersPage from "@/app/(admin)/admin/(delivery)/carriers/page";
import DeliveryPage from "@/app/(admin)/admin/(analytics)/delivery/page";
import EventsPage from "@/app/(admin)/admin/(events)/events/page";
import NotificationsPage from "@/app/(admin)/admin/(ops)/notifications/page";
import AdjustmentsPage from "@/app/(admin)/admin/(accounting)/adjustments/page";
import SubmitScreenPage from "@/app/(admin)/admin/(events)/submit-screen/page";
import { DriverNotificationsPreview, RewardsPreview, HomeLoadingPreview, DriverRecordsPreview, PlatformHomePreview, PlatformApplicationsPreview } from "../driver-loading-pages";
import AttendancePage from "@/app/(admin)/admin/(ops)/attendance/page";
import CounterpartiesPage from "@/app/(admin)/admin/(accounting)/counterparties/page";
import RecordsPage from "@/app/(admin)/admin/(ops)/records/page";
import RecordFormsPage from "@/app/(admin)/admin/(ops)/record-forms/page";
import MiscReportsPage from "@/app/(admin)/admin/(ops)/misc-reports/page";
import OtherReportsPage from "@/app/(admin)/admin/(ops)/misc-reports/others/page";
import { utilityLoadingFixture } from "./loadingAudit";
import { carriersFixture, deliveryFixture, eventsFixture, notificationsFixture, driverNotificationsFixture, rewardsFixture, adjustmentsFixture, submitScreenFixture } from "./loadingAudit";

export type PreviewPageEntry = {
  /** URLの末尾（/preview/admin/<slug>） */
  slug: string;
  fixture: PreviewFixture<unknown>;
  Page: ComponentType;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const entry = <S,>(slug: string, fixture: PreviewFixture<S>, Page: ComponentType): PreviewPageEntry => ({ slug, fixture: fixture as PreviewFixture<any>, Page });

export const PREVIEW_PAGES: PreviewPageEntry[] = [
  entry("attendance", { ...utilityLoadingFixture, id: "attendance", title: "勤怠", pathname: "/admin/attendance" }, AttendancePage),
  entry("counterparties", { ...utilityLoadingFixture, id: "counterparties", title: "取引先", pathname: "/admin/counterparties" }, CounterpartiesPage),
  entry("records", { ...utilityLoadingFixture, id: "records", title: "記録・報告", pathname: "/admin/records" }, RecordsPage),
  entry("record-forms", { ...utilityLoadingFixture, id: "record-forms", title: "フォーム管理", pathname: "/admin/record-forms" }, RecordFormsPage),
  entry("misc-reports", { ...utilityLoadingFixture, id: "misc-reports", title: "諸報告", pathname: "/admin/misc-reports" }, MiscReportsPage),
  entry("other-reports", { ...utilityLoadingFixture, id: "other-reports", title: "その他の報告", pathname: "/admin/misc-reports/others" }, OtherReportsPage),
  entry("driver-records", { ...utilityLoadingFixture, id: "driver-records", title: "本人の記録・報告", pathname: "/me/records" }, DriverRecordsPreview),
  entry("platform-home", { ...utilityLoadingFixture, id: "platform-home", title: "運営窓口", pathname: "/platform" }, PlatformHomePreview),
  entry("platform-applications", { ...utilityLoadingFixture, id: "platform-applications", title: "会社の申請", pathname: "/platform/applications" }, PlatformApplicationsPreview),
  entry("home-loading", { id: "home-loading", title: "ホームの遷移待ち", pathname: "/", scenarios: { normal: { label: "通常" } }, createState: () => null, read: () => undefined }, HomeLoadingPreview),
  entry("carriers", carriersFixture, CarriersPage),
  entry("delivery", deliveryFixture, DeliveryPage),
  entry("events", eventsFixture, EventsPage),
  entry("notifications", notificationsFixture, NotificationsPage),
  entry("driver-notifications", driverNotificationsFixture, DriverNotificationsPreview),
  entry("rewards", rewardsFixture, RewardsPreview),
  entry("adjustments", adjustmentsFixture, AdjustmentsPage),
  entry("submit-screen", submitScreenFixture, SubmitScreenPage),
  entry("sales", salesFixture, SalesPage),
  entry("driver-report", reportFixture, ReportPreview),
  entry("organization", organizationFixture, OrganizationPage),
  entry("shifts", shiftsFixture, ShiftsPage),
  entry("spot-jobs", spotJobsFixture, SpotJobsPage),
  entry("shift-memos", { ...shiftsFixture, title: "シフトメモ", pathname: "/admin/shift-memos" }, ShiftMemosPage),
  entry("report-kinds", reportKindsFixture, ReportKindsPage),
  entry("report-image-templates", reportImageTemplatesFixture, ReportImageTemplatesPage),
  entry("daily", dailyFixture, AdminDailyPage),
  entry("report-images", reportImagesFixture, ReportImagesPage),
  entry("invoice-preview", invoicePreviewFixture, InvoicePreviewPage),
  entry("invoice-edit", invoiceEditFixture, InvoiceEditPage),
  entry("invoice-individual-preview", individualInvoicePreviewFixture, InvoicePreviewPage),
  entry("invoice-individual-edit", individualInvoiceEditFixture, InvoiceEditPage),
  entry("invoice-list", invoiceListFixture, InvoiceListPage),
  entry("invoice-new", invoiceNewFixture, InvoiceNewPage),
  entry("dashboard", dashboardFixture, DashboardPage),
  entry("vehicles", vehiclesFixture, VehiclesPage),
  entry("users", usersFixture, UsersPage),
  entry("users-pending", usersPendingFixture, UsersPendingPage),
  entry("bank-cleanup", bankCleanupFixture, BankCleanupPage),
  entry("courses", coursesFixture, CoursesPage),
  entry("roles", rolesFixture, RolesPage),
  entry("payments", paymentsFixture, PaymentsPage),
  entry("account", accountFixture, AccountPage),
  entry("platform-recovery", platformRecoveryFixture, PlatformRecoveryPreview),
  entry("login", loginFixture, LoginPreview),
  entry("onboarding", onboardingFixture, OnboardingPreview),
  entry("recover", recoverFixture, RecoverPreview),
  entry("me", meFixture, MePreview),
  entry("bank-change", { ...meFixture, id: "bank-change", title: "振込口座の変更", pathname: "/account/bank-change" }, BankChangePreview),
  entry("driver-setup-designs", { ...meFixture, id: "driver-setup-designs", title: "利用開始準備の3案比較", pathname: "/driver-setup-designs" }, DriverSetupDesigns),
  entry("driver-setup", { ...meFixture, id: "driver-setup", title: "利用開始の準備", pathname: "/driver-setup" }, DriverSetupPreview),
  // 地図は Mapbox の公開キーが要る: npm run preview:admin -- admin --mapbox
  entry("map", mapFixture, MapPage),
  // ドライバー画面（管理レイアウトなし）。日報の「車の置き場所」の確認用
  entry("submit", submitFixture, SubmitPage),
  // ドライバー画面。予定の確認（確認／対応できない）の監査用
  entry("my-shifts", myShiftsFixture, MyShiftsPage),
];

export function findPageBySlug(slug: string) {
  return PREVIEW_PAGES.find((page) => page.slug === slug);
}

export function findPageByPathname(pathname: string) {
  return PREVIEW_PAGES.find((page) => page.fixture.pathname === pathname);
}
