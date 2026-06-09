"use client";

import { useState } from "react";
import ShiftDeadlineSettingsModal from "./ShiftDeadlineSettingsModal";
import ShiftSlotsSettingsModal from "./ShiftSlotsSettingsModal";

// ============================================================
// 「シフト提出の設定」: 提出締切 と 便（時間帯）をタブでまとめた設定モーダル。
//   各タブは既存パネルを embedded で埋め込み（保存はタブごと）。
// ============================================================

interface Props {
  open: boolean;
  canWrite: boolean;
  onClose: () => void;
}
type Tab = "deadline" | "slots";

const TABS: [Tab, string][] = [
  ["deadline", "提出締切"],
  ["slots", "便（時間帯）"],
];

export default function ShiftSubmitSettingsModal({ open, canWrite, onClose }: Props) {
  const [tab, setTab] = useState<Tab>("deadline");
  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-3">シフト提出の設定</h2>
          <div className="flex rounded-lg bg-slate-100 p-0.5 mb-2">
            {TABS.map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={`flex-1 px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                  tab === id ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-800"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* 両タブを常時マウントし、表示だけ切替（編集内容を保持） */}
          <div className={tab === "deadline" ? "" : "hidden"}>
            <ShiftDeadlineSettingsModal open embedded canWrite={canWrite} onClose={onClose} />
          </div>
          <div className={tab === "slots" ? "" : "hidden"}>
            <ShiftSlotsSettingsModal open embedded canWrite={canWrite} onClose={onClose} />
          </div>
        </div>
      </div>
    </div>
  );
}
