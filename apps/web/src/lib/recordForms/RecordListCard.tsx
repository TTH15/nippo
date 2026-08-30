import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronRight } from "@fortawesome/free-solid-svg-icons";

type Props = {
  title: string;
  items: { id: string; label: string; value: string }[];
  status?: { label: string; terminal: boolean };
  onOpen?: () => void;
};

/** 一覧と設定内の表示例で、同じカードの描画を使う。 */
export function RecordListCard({ title, items, status, onOpen }: Props) {
  const content = (
    <>
      <div className="min-w-0 flex-1">
        <p className="break-words font-semibold text-slate-900">{title}</p>
        {items.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
            {items.map((item) => (
              <div key={item.id} className="min-w-0 break-words text-xs">
                <span className="mr-2 text-slate-400">{item.label}</span>
                <span className="text-slate-600">{item.value}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {status && (
        <span
          className={`rounded-md px-2.5 py-1 text-xs font-medium ${status.terminal ? "bg-slate-100 text-slate-500" : "bg-amber-50 text-amber-800"}`}
        >
          {status.label}
        </span>
      )}
      <FontAwesomeIcon
        icon={faChevronRight}
        className="mt-1 h-3 w-3 text-slate-300"
      />
    </>
  );
  const className =
    "flex w-full flex-wrap items-start gap-4 border-b border-slate-100 p-5 text-left last:border-0";
  return onOpen ? (
    <button
      type="button"
      onClick={onOpen}
      className={`${className} hover:bg-slate-50`}
    >
      {content}
    </button>
  ) : (
    <div className={className}>{content}</div>
  );
}
