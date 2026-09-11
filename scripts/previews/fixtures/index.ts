// プレビューで開ける本番ページの登録表。1ページ = 本番の page.tsx + fixture。
// 追加するときはここに1行足し、docs/development/preview-workflow.md の一覧も更新する。
import type { ComponentType } from "react";
import type { PreviewFixture } from "@/lib/preview/fixtureStore";
import DashboardPage from "@/app/(admin)/admin/page";
import VehiclesPage from "@/app/(admin)/admin/(resource)/vehicles/page";
import UsersPage from "@/app/(admin)/admin/(resource)/users/page";
import MapPage from "@/app/(admin)/admin/(ops)/map/page";
import PaymentsPage from "@/app/(admin)/admin/(accounting)/payments/page";
import SubmitPage from "@/app/(user)/submit/SubmitPageClientV2";
import AccountPage from "@/app/(admin)/admin/account/page";
import LoginPreview from "../login";
import { dashboardFixture } from "./dashboard";
import { vehiclesFixture } from "./vehicles";
import { usersFixture } from "./users";
import { mapFixture } from "./map";
import { paymentsFixture } from "./payments";
import { submitFixture } from "./submit";
import { accountFixture } from "./account";
import { loginFixture } from "./login";

export type PreviewPageEntry = {
  /** URLの末尾（/preview/admin/<slug>） */
  slug: string;
  fixture: PreviewFixture<unknown>;
  Page: ComponentType;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const entry = <S,>(slug: string, fixture: PreviewFixture<S>, Page: ComponentType): PreviewPageEntry => ({ slug, fixture: fixture as PreviewFixture<any>, Page });

export const PREVIEW_PAGES: PreviewPageEntry[] = [
  entry("dashboard", dashboardFixture, DashboardPage),
  entry("vehicles", vehiclesFixture, VehiclesPage),
  entry("users", usersFixture, UsersPage),
  entry("payments", paymentsFixture, PaymentsPage),
  entry("account", accountFixture, AccountPage),
  entry("login", loginFixture, LoginPreview),
  // 地図は Mapbox の公開キーが要る: npm run preview:admin -- admin --mapbox
  entry("map", mapFixture, MapPage),
  // ドライバー画面（管理レイアウトなし）。日報の「車の置き場所」の確認用
  entry("submit", submitFixture, SubmitPage),
];

export function findPageBySlug(slug: string) {
  return PREVIEW_PAGES.find((page) => page.slug === slug);
}

export function findPageByPathname(pathname: string) {
  return PREVIEW_PAGES.find((page) => page.fixture.pathname === pathname);
}
