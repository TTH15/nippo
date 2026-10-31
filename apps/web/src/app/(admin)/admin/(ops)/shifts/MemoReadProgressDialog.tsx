"use client";
import { useReducedMotion } from "motion/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faSpinner } from "@fortawesome/free-solid-svg-icons";
import { EditorModal } from "@/lib/components/EditorModal";
import { useDialogTabLoop } from "@/lib/hooks/useDialogTabLoop";

export function MemoReadProgressDialog({ fileName, onCancel }: { fileName: string; onCancel: () => void }) {
  useDialogTabLoop();
  const reducedMotion = useReducedMotion();
  return <EditorModal title="シフトメモを読み取り中" variant="shift" onClose={onCancel}
    footer={<button type="button" onClick={onCancel} className="min-h-11 rounded-lg border border-slate-300 px-4 text-xs font-semibold text-slate-700">中止</button>}>
    <div role="status" aria-live="polite" className="flex items-center gap-3 py-6 text-sm text-slate-700">
      <FontAwesomeIcon icon={faSpinner} spin={!reducedMotion} className="text-slate-500" />
      <span className="min-w-0 break-all">{fileName}</span>
    </div>
  </EditorModal>;
}
