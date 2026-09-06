// 本番パス（/admin/...）とプレビューURL（/preview/admin/<slug>）の相互変換。
import { PREVIEW_PAGES } from "../fixtures";

export const PREVIEW_PREFIX = "/preview/admin";

/** 本番パスをプレビューURLへ。未登録のページは一覧（案内付き）へ飛ばす。scenario/role は引き継ぐ */
export function toPreviewHref(adminHref: string, currentSearch: string): string {
  const [pathname, query = ""] = adminHref.split("?");
  const page = PREVIEW_PAGES.find((entry) => entry.fixture.pathname === pathname);
  const params = new URLSearchParams(query);
  const current = new URLSearchParams(currentSearch.startsWith("?") ? currentSearch.slice(1) : currentSearch);
  for (const key of ["scenario", "role"]) {
    const value = current.get(key);
    if (value && !params.has(key)) params.set(key, value);
  }
  if (!page) params.set("missing", pathname);
  const target = page ? `${PREVIEW_PREFIX}/${page.slug}` : PREVIEW_PREFIX;
  const search = params.toString();
  return search ? `${target}?${search}` : target;
}

/** プレビューURLのパスから登録ページの slug を取り出す。一覧なら null */
export function slugFromPreviewPath(pathname: string): string | null {
  if (!pathname.startsWith(PREVIEW_PREFIX)) return null;
  const rest = pathname.slice(PREVIEW_PREFIX.length).replace(/^\/+|\/+$/g, "");
  return rest || null;
}
