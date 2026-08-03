"use client";

import { useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck, faMagnifyingGlass } from "@fortawesome/free-solid-svg-icons";

// ============================================================
// コース選択（承認モーダル・ドライバー編集などで共用）。
// コースは数十件あり一列に並べると読めないため、
//   ① キャリア（ヤマト / Amazon / 郵便局…）で見出しグループ化
//   ② 各チップにコース色のドット（シフト表と同じ色の記憶が使える）
//   ③ 絞り込み入力（コースが増えても寿命が長い対策）
// の3点で走査コストを下げる。選択済みはチェック＋濃色で明示する。
// ============================================================

export type PickableCourse = {
  id: string;
  name: string;
  color?: string | null;
  /** キャリア名（グループ見出し）。無い場合は「その他」にまとめる */
  carrier_name?: string | null;
};

const OTHER_GROUP = "その他";

export function CoursePicker({
  courses,
  selectedIds,
  onToggle,
  disabled = false,
  emptyLabel = "コースがありません",
}: {
  courses: PickableCourse[];
  selectedIds: string[];
  onToggle: (courseId: string) => void;
  disabled?: boolean;
  emptyLabel?: string;
}) {
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? courses.filter(
          (c) =>
            c.name.toLowerCase().includes(q) || (c.carrier_name ?? "").toLowerCase().includes(q),
        )
      : courses;
    const map = new Map<string, PickableCourse[]>();
    for (const c of filtered) {
      const key = c.carrier_name?.trim() || OTHER_GROUP;
      const arr = map.get(key) ?? [];
      arr.push(c);
      map.set(key, arr);
    }
    // 件数の多いキャリアを先に。「その他」は常に最後。
    return Array.from(map.entries()).sort(([a, ax], [b, bx]) => {
      if (a === OTHER_GROUP) return 1;
      if (b === OTHER_GROUP) return -1;
      return bx.length - ax.length;
    });
  }, [courses, query]);

  const selected = new Set(selectedIds);

  return (
    <div className="space-y-2">
      {courses.length > 8 && (
        <div className="relative">
          <FontAwesomeIcon
            icon={faMagnifyingGlass}
            className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-400"
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="コース名で絞り込み"
            className="w-full rounded-lg border border-slate-200 py-1.5 pl-8 pr-3 text-sm focus:border-slate-400 focus:outline-none"
          />
        </div>
      )}

      {groups.length === 0 ? (
        <p className="py-2 text-xs text-slate-400">{query ? "該当するコースがありません" : emptyLabel}</p>
      ) : (
        groups.map(([carrier, list]) => (
          <div key={carrier}>
            <p className="mb-1 text-[11px] font-semibold text-slate-400">
              {carrier}
              <span className="ml-1 font-normal text-slate-300">{list.length}</span>
            </p>
            <div className="flex flex-wrap gap-1.5">
              {list.map((c) => {
                const on = selected.has(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => onToggle(c.id)}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 ${
                      on
                        ? "border-slate-800 bg-slate-800 text-white"
                        : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {on ? (
                      <FontAwesomeIcon icon={faCheck} className="h-3 w-3" />
                    ) : (
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: c.color || "#cbd5e1" }}
                      />
                    )}
                    {c.name}
                  </button>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
