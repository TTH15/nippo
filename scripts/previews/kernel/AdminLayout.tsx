// "@/lib/components/AdminLayout" の差し替え。実画面の複製レイアウト（AdminPreviewLayout）に、
// シナリオ・役割の切替バーを載せる。ページ本体のJSXは本番のまま。
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faList, faRotateLeft, faTriangleExclamation } from "@fortawesome/free-solid-svg-icons";
import { AdminPreviewLayout } from "@/app/preview/driver-leases/AdminPreviewLayout";
import { buildPreviewHref, PREVIEW_ROLES, PREVIEW_ROLE_ORDER, type PreviewRole } from "@/lib/preview/scenario";
import { usePreviewRuntime, useStoreRevision } from "./runtime";
import { PREVIEW_PREFIX } from "./paths";

const pill = "rounded-full border px-2 py-0.5 text-[11px] font-bold leading-4 transition-colors";
const pillOff = `${pill} border-slate-300 bg-white text-slate-600 hover:border-slate-400`;
const pillOn = `${pill} border-slate-900 bg-slate-900 text-white`;

function ScenarioBar() {
  const { store, search } = usePreviewRuntime();
  useStoreRevision(store);
  const currentPath = window.location.pathname;
  const go = (next: { scenario?: string; role?: PreviewRole }) => {
    const href = buildPreviewHref(currentPath, { scenario: next.scenario ?? store.scenario, role: next.role ?? store.role }, search);
    window.location.assign(href);
  };
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-200 pb-2 text-[11px] text-slate-500" data-preview-bar>
      <a href={PREVIEW_PREFIX} className="inline-flex items-center gap-1 font-bold text-slate-700 hover:underline">
        <FontAwesomeIcon icon={faList} className="h-3 w-3" />
        一覧
      </a>
      <span className="font-bold text-slate-700">{store.fixture.title}</span>
      <span className="flex flex-wrap items-center gap-1" aria-label="シナリオ">
        {Object.entries(store.scenarios).map(([key, definition]) => (
          <button key={key} type="button" title={definition.description} className={key === store.scenario ? pillOn : pillOff} onClick={() => go({ scenario: key })}>
            {definition.label}
          </button>
        ))}
      </span>
      <span className="flex flex-wrap items-center gap-1" aria-label="役割">
        {PREVIEW_ROLE_ORDER.map((role) => (
          <button key={role} type="button" className={role === store.role ? pillOn : pillOff} onClick={() => go({ role })}>
            {PREVIEW_ROLES[role].label}
          </button>
        ))}
      </span>
      <span className="ml-auto flex items-center gap-1">
        <button
          type="button"
          className={`${store.willFailNextWrite ? "border-amber-400 bg-amber-50 text-amber-800" : "border-slate-300 bg-white"} inline-flex items-center gap-1 rounded border px-2 py-1`}
          onClick={() => store.failNextWrite()}
        >
          <FontAwesomeIcon icon={faTriangleExclamation} className="h-3 w-3" />
          {store.willFailNextWrite ? "次の保存は失敗します" : "次の保存を失敗させる"}
        </button>
        <button type="button" className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1" onClick={() => store.reset()}>
          <FontAwesomeIcon icon={faRotateLeft} className="h-3 w-3" />
          初期化
        </button>
      </span>
    </div>
  );
}

export function AdminLayout({ children }: { children: React.ReactNode }) {
  const { store, pathname } = usePreviewRuntime();
  return (
    <AdminPreviewLayout
      pathname={pathname}
      onReset={() => store.reset()}
      viewer={{ name: store.driver.name, role: store.driver.role, capabilities: store.driver.capabilities }}
      noticeLabel="プレビュー · 架空データ・本番ページのコード・外部送信なし"
    >
      <ScenarioBar />
      {children}
    </AdminPreviewLayout>
  );
}
