// プレビューで開ける本番ページの登録表。1ページ = 本番の page.tsx + fixture。
// 追加するときはここに1行足し、docs/development/preview-workflow.md の一覧も更新する。
import type { ComponentType } from "react";
import type { PreviewFixture } from "@/lib/preview/fixtureStore";
import DashboardPage from "@/app/(admin)/admin/page";
import VehiclesPage from "@/app/(admin)/admin/(resource)/vehicles/page";
import UsersPage from "@/app/(admin)/admin/(resource)/users/page";
import { dashboardFixture } from "./dashboard";
import { vehiclesFixture } from "./vehicles";
import { usersFixture } from "./users";

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
];

export function findPageBySlug(slug: string) {
  return PREVIEW_PAGES.find((page) => page.slug === slug);
}

export function findPageByPathname(pathname: string) {
  return PREVIEW_PAGES.find((page) => page.fixture.pathname === pathname);
}
