"use client";

import { useCallback, useId, useRef, useState, type KeyboardEvent } from "react";
import ShiftDeadlineSettingsModal from "./ShiftDeadlineSettingsModal";
import ShiftSlotsSettingsModal from "./ShiftSlotsSettingsModal";
import ShiftStaffingSettingsModal from "./ShiftStaffingSettingsModal";
import ShiftReadinessSettingsPanel from "./ShiftReadinessSettingsPanel";
import { ConfirmDialog } from "@/lib/components/ConfirmDialog";
import { useModalKeys } from "@/lib/ui/dialog";

// ============================================================
// 「シフト提出の設定」: 提出締切・便（時間帯）・必要人数・未解決の期限をタブでまとめた設定モーダル。
//   各タブは既存パネルを embedded で埋め込み（保存はタブごと）。
//   どのタブも明示保存なので、未保存のまま閉じようとしたら確認を出す。
//
// Escape・初期フォーカス・Tab の閉じ込めは共通の useModalKeys に任せる。
// 確認ダイアログが上に出ている間は、そちらへ Escape を譲る（dialog.ts 側で判定）。
// ============================================================

interface Props {
  open: boolean;
  canWrite: boolean;
  /** 必要人数タブで使うコース・便 */
  courses: { id: string; name: string | null; uses_cycles?: boolean | null; archived_at?: string | null; course_cycles?: { cycle_no: number; label?: string | null; active?: boolean | null }[] | null }[];
  onClose: () => void;
}
type Tab = "deadline" | "slots" | "staffing" | "readiness";

const TABS: [Tab, string][] = [
  ["deadline", "提出締切"],
  ["slots", "便（時間帯）"],
  ["staffing", "必要人数"],
  ["readiness", "未解決の期限"],
];

export default function ShiftSubmitSettingsModal({ open, canWrite, courses, onClose }: Props) {
  const [tab, setTab] = useState<Tab>("deadline");
  // ★判定は ref で持つ。子は「保存した→未保存ではない」を伝えた直後に閉じるので、
  //   state の反映を待つ形だと、保存した直後に「保存していない変更」の確認が出てしまう。
  //   表示に使わないので state は持たない。
  const dirtyRef = useRef<Record<string, boolean>>({});
  const [confirmingClose, setConfirmingClose] = useState(false);
  const titleId = useId();
  const baseId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const requestClose = useCallback(() => {
    if (Object.values(dirtyRef.current).some(Boolean)) setConfirmingClose(true);
    else onClose();
  }, [onClose]);

  // Escape・初期フォーカス・Tab の閉じ込めは共通フックへ
  useModalKeys(open, requestClose, panelRef);

  const markDirty = useCallback(
    (key: Tab) => (value: boolean) => {
      dirtyRef.current = { ...dirtyRef.current, [key]: value };
    },
    [],
  );

  const tabId = (id: Tab) => `${baseId}-tab-${id}`;
  const panelId = (id: Tab) => `${baseId}-panel-${id}`;

  /** 左右キーでタブを移動する（WAI-ARIA の tab パターン） */
  const onTabKeyDown = (event: KeyboardEvent, index: number) => {
    const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (delta === 0) return;
    event.preventDefault();
    const next = TABS[(index + delta + TABS.length) % TABS.length][0];
    setTab(next);
    tabRefs.current[next]?.focus();
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={requestClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal={!confirmingClose}
        aria-labelledby={titleId}
        inert={confirmingClose}
        tabIndex={-1}
        className="bg-white rounded-lg shadow-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6">
          <h2 id={titleId} className="text-lg font-semibold text-slate-900 mb-3">シフト提出の設定</h2>
          {/* 4タブは狭い幅で1行に収まらない。横スクロールだと端のタブに気づけないので折り返す */}
          <div role="tablist" aria-label="シフト提出の設定" className="mb-2 flex flex-wrap gap-0.5 rounded-lg bg-slate-100 p-0.5">
            {TABS.map(([id, label], index) => (
              <button
                key={id}
                ref={(node) => { tabRefs.current[id] = node; }}
                type="button"
                role="tab"
                id={tabId(id)}
                aria-selected={tab === id}
                aria-controls={panelId(id)}
                tabIndex={tab === id ? 0 : -1}
                onKeyDown={(event) => onTabKeyDown(event, index)}
                onClick={() => setTab(id)}
                className={`min-h-11 flex-1 basis-[calc(50%-2px)] whitespace-nowrap rounded-md px-2 text-xs font-medium transition-colors sm:basis-0 sm:px-4 sm:text-sm ${
                  tab === id ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-800"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* 各タブを常時マウントし、表示だけ切替（編集内容を保持） */}
          <div role="tabpanel" id={panelId("deadline")} aria-labelledby={tabId("deadline")} className={tab === "deadline" ? "" : "hidden"}>
            <ShiftDeadlineSettingsModal open embedded canWrite={canWrite} onClose={requestClose} onDirtyChange={markDirty("deadline")} />
          </div>
          <div role="tabpanel" id={panelId("slots")} aria-labelledby={tabId("slots")} className={tab === "slots" ? "" : "hidden"}>
            <ShiftSlotsSettingsModal open embedded canWrite={canWrite} onClose={requestClose} onDirtyChange={markDirty("slots")} />
          </div>
          <div role="tabpanel" id={panelId("staffing")} aria-labelledby={tabId("staffing")} className={tab === "staffing" ? "" : "hidden"}>
            <ShiftStaffingSettingsModal canWrite={canWrite} courses={courses} onDirtyChange={markDirty("staffing")} onClose={requestClose} />
          </div>
          <div role="tabpanel" id={panelId("readiness")} aria-labelledby={tabId("readiness")} className={tab === "readiness" ? "" : "hidden"}>
            <ShiftReadinessSettingsPanel canWrite={canWrite} onDirtyChange={markDirty("readiness")} onClose={requestClose} />
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmingClose}
        title="保存していない変更"
        message="閉じると変更は保存されません。"
        confirmLabel="保存せずに閉じる"
        cancelLabel="編集に戻る"
        onConfirm={() => {
          setConfirmingClose(false);
          onClose();
        }}
        onClose={() => setConfirmingClose(false)}
      />
    </div>
  );
}
