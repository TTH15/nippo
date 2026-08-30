import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronRight, faFileLines } from "@fortawesome/free-solid-svg-icons";
import type { RecordForm } from "./model";

export function FormManagement({
  forms,
  onConfigure,
}: {
  forms: RecordForm[];
  onConfigure: (form: RecordForm) => void;
}) {
  return (
    <section aria-label="フォーム一覧" className="space-y-4">
      <p className="text-sm text-slate-500">
        記録に使う入力項目と、利用できる人を設定します。
      </p>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {forms.map((form) => (
          <button
            key={form.id}
            type="button"
            onClick={() => onConfigure(form)}
            aria-label={`${form.name}の設定を開く`}
            className="flex w-full items-center gap-4 border-b border-slate-100 p-5 text-left transition-colors last:border-0 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-400 motion-reduce:transition-none"
          >
            <FontAwesomeIcon
              icon={faFileLines}
              className="size-5 shrink-0 text-slate-400"
            />
            <div className="min-w-0 flex-1">
              <h2 className="break-words font-semibold text-slate-900">
                {form.name}
              </h2>
              <p className="mt-2 text-xs text-slate-500">
                {form.category && `${form.category} · `}
                {form.fields.length}項目
              </p>
            </div>
            <span className="hidden text-xs text-slate-500 sm:block">
              {form.driver.submit ? "ドライバーも報告可能" : "運営側から入力"}
            </span>
            <span className="flex shrink-0 items-center gap-3 text-sm text-slate-600">
              設定
              <FontAwesomeIcon
                icon={faChevronRight}
                className="size-3 text-slate-400"
              />
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
