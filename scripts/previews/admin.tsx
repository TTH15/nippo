// Standalone runner entry only. Not a Next route; live auth/API imports are replaced at build time.
// /preview/admin            … 登録ページ × シナリオ × 役割の一覧
// /preview/admin/<slug>?scenario=<name>&role=<admin|accounting|viewer> … 本番ページ本体を fixture で表示
import { useEffect, useMemo, useState } from "react";
import { createFixtureStore } from "@/lib/preview/fixtureStore";
import { buildPreviewHref, parsePreviewLocation, PREVIEW_ROLES, PREVIEW_ROLE_ORDER } from "@/lib/preview/scenario";
import { scenariosOf } from "@/lib/preview/fixtureStore";
import { PREVIEW_PAGES, findPageBySlug } from "./fixtures";
import { PreviewRuntimeContext, setPreviewRuntime, type PreviewRuntime } from "./kernel/runtime";
import { PREVIEW_PREFIX, slugFromPreviewPath, toPreviewHref } from "./kernel/paths";

function useLocation() {
  const read = () => ({ pathname: window.location.pathname, search: window.location.search });
  const [location, setLocation] = useState(read);
  useEffect(() => {
    const onChange = () => setLocation(read());
    window.addEventListener("popstate", onChange);
    window.addEventListener("preview:navigate", onChange);
    return () => {
      window.removeEventListener("popstate", onChange);
      window.removeEventListener("preview:navigate", onChange);
    };
  }, []);
  return location;
}

function navigate(adminHref: string) {
  const href = toPreviewHref(adminHref, window.location.search);
  window.history.pushState(null, "", href);
  window.dispatchEvent(new Event("preview:navigate"));
}

function IndexPage({ missing }: { missing: string | null }) {
  return (
    <div className="min-h-screen bg-slate-100 px-4 py-8">
      <div className="mx-auto max-w-2xl space-y-5">
        <div>
          <h1 className="text-lg font-bold text-slate-900">管理画面プレビュー（本番ページ本体）</h1>
          <p className="mt-1 text-xs text-slate-500">ログイン不要。URLの scenario と role で任意の状態を開く。架空データ・外部送信なし。</p>
        </div>
        {missing && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
            <span className="font-bold">{missing}</span> はまだプレビューに登録されていません。scripts/previews/fixtures に fixture を追加すると開けます。
          </div>
        )}
        <div className="space-y-3">
          {PREVIEW_PAGES.map((page) => {
            const scenarios = scenariosOf(page.fixture);
            const base = `${PREVIEW_PREFIX}/${page.slug}`;
            return (
              <div key={page.slug} className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <a href={base} className="text-sm font-semibold text-slate-900 hover:underline">{page.fixture.title}</a>
                  <span className="text-[11px] text-slate-400">{page.fixture.pathname}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {Object.entries(scenarios).map(([key, definition]) => (
                    <a key={key} href={buildPreviewHref(base, { scenario: key })} title={definition.description} className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-bold text-slate-600 hover:border-slate-500">
                      {definition.label}
                    </a>
                  ))}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {PREVIEW_ROLE_ORDER.map((role) => (
                    <a key={role} href={buildPreviewHref(base, { role })} className="rounded-full border border-dashed border-slate-300 px-2 py-0.5 text-[11px] font-bold text-slate-500 hover:border-slate-500">
                      {PREVIEW_ROLES[role].label}で開く
                    </a>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-[11px] text-slate-400">例: {PREVIEW_PREFIX}/vehicles?scenario=long-name&role=viewer</p>
      </div>
    </div>
  );
}

export default function AdminPreviewApp() {
  const location = useLocation();
  const slug = slugFromPreviewPath(location.pathname);
  const page = slug ? findPageBySlug(slug) : undefined;
  const { scenario, role } = parsePreviewLocation(location.search);

  // ページ・シナリオ・役割が変わったら fixture を作り直す（本番でルート遷移で再マウントされるのと同じ）
  const store = useMemo(() => (page ? createFixtureStore(page.fixture, { scenario, role }) : null), [page, scenario, role]);
  // runtime は描画前に確定させる（子の useSWR・Link が初回描画で参照する）。通知は行わず、
  // フック側は Context で受け取るので描画中の購読者更新は起きない。
  const runtime = useMemo<PreviewRuntime | null>(() => {
    if (!page || !store) return null;
    const next = { store, pathname: page.fixture.pathname, search: location.search, navigate };
    setPreviewRuntime(next);
    return next;
  }, [page, store, location.search]);
  useEffect(() => {
    if (page) document.title = `ハコ虎｜プレビュー ${page.fixture.title}`;
  }, [page]);

  if (!page || !store || !runtime) {
    const params = new URLSearchParams(location.search);
    return <IndexPage missing={slug ? `${PREVIEW_PREFIX}/${slug}` : params.get("missing")} />;
  }
  const Page = page.Page;
  return (
    <PreviewRuntimeContext.Provider value={runtime}>
      <Page key={`${page.slug}:${store.scenario}:${store.role}`} />
    </PreviewRuntimeContext.Provider>
  );
}
