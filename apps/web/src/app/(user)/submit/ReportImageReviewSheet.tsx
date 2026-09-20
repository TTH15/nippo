"use client";

import { useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTriangleExclamation, faCircleCheck } from "@fortawesome/free-solid-svg-icons";
import { EditorModal } from "@/lib/components/EditorModal";
import { DigitInput } from "@/lib/components/DigitInput";
import { Button } from "@/lib/ui/button";
import type { Box, FieldRead, ReadTrust } from "@repo/core/logic/reportImageTemplate";

// ============================================================
// 画像から読み取った件数を、原本と見比べて直してから日報へ入れる。
// 設計: docs/design/report-image-evidence-2026-09.md（RIMG-3）
//
// **毎回画像と見比べさせない。** 表の中の合計（配完+持戻=計B+持戻C、合計=各行の和…）が
// 全部閉じていれば、欄を取り違えていないことは機械が示せる。そのときは数字だけを出して1タップで終える。
// 機械が確信を持てなかったときだけ、原本の枠とその欄を切り出した画像を開いて確かめてもらう。
// 読めなかった欄は空のままにする（0で埋めない）。
// ============================================================

export type ReviewRow = {
  fieldId: string;
  unitId: string;
  fieldKey: string;
  label: string;
  value: number | null;
  status: FieldRead["status"];
  box: Box | null;
  cropUrl: string | null;
};

const STATUS_BADGE: Partial<Record<FieldRead["status"], string>> = {
  uncertain: "確認",
  out_of_range: "確認",
  not_found: "未取得",
  no_anchor: "未取得",
};

export function ReportImageReviewSheet({
  templateName,
  imageUrl,
  imageWidth,
  imageHeight,
  rows,
  warnings,
  trust,
  saving,
  onChange,
  onCancel,
  onConfirm,
}: {
  templateName: string;
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  rows: ReviewRow[];
  warnings: string[];
  trust: ReadTrust;
  saving: boolean;
  onChange: (fieldId: string, value: number | null) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const verified = trust.level === "verified";
  const [showEvidence, setShowEvidence] = useState(!verified);
  // 理由と重なる警告は出さない（同じ文が2回並ぶと読みにくい）
  const extraWarnings = warnings.filter((warning) => !trust.reasons.some((reason) => warning.startsWith(reason.slice(0, 12))));
  const boxes = useMemo(
    () => rows.filter((row) => row.box).map((row) => ({ id: row.fieldId, box: row.box as Box, read: row.status === "read" })),
    [rows],
  );
  const canConfirm = rows.some((row) => row.value != null) && !saving;

  return (
    <EditorModal
      title="読み取った件数"
      onClose={onCancel}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="touch" onClick={onCancel} disabled={saving}>
            手入力にする
          </Button>
          {verified && !showEvidence && (
            <Button variant="outline" size="touch" onClick={() => setShowEvidence(true)}>
              画像で確かめる
            </Button>
          )}
          <Button size="touch" onClick={onConfirm} disabled={!canConfirm}>
            {saving ? "保存中…" : "日報に入れる"}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs font-medium text-slate-500">{templateName}</p>
          {verified && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
              <FontAwesomeIcon icon={faCircleCheck} className="h-3 w-3" />
              表の合計{trust.checksRun}本と一致
            </span>
          )}
        </div>

        {showEvidence && (
        <div className="relative overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
          {/* 原本（回転を直したもの）。読んだ欄を枠で示す */}
          <img src={imageUrl} alt="提出した画像" className="block w-full" />
          {boxes.map((item) => (
            <span
              key={item.id}
              aria-hidden
              className={`absolute rounded-sm border-2 ${item.read ? "border-emerald-500/80" : "border-amber-500/80"}`}
              style={{
                left: `${(item.box.x / imageWidth) * 100}%`,
                top: `${(item.box.y / imageHeight) * 100}%`,
                width: `${(item.box.w / imageWidth) * 100}%`,
                height: `${(item.box.h / imageHeight) * 100}%`,
              }}
            />
          ))}
        </div>
        )}

        {trust.reasons.length > 0 && (
          <ul className="space-y-1 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
            {trust.reasons.map((reason) => (
              <li key={reason} className="flex gap-2">
                <FontAwesomeIcon icon={faTriangleExclamation} className="mt-0.5 h-3 w-3 shrink-0" />
                <span>{reason}</span>
              </li>
            ))}
          </ul>
        )}

        {showEvidence && extraWarnings.length > 0 && (
          <ul className="space-y-1 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
            {extraWarnings.map((warning) => (
              <li key={warning} className="flex gap-2">
                <FontAwesomeIcon icon={faTriangleExclamation} className="mt-0.5 h-3 w-3 shrink-0" />
                <span>{warning}</span>
              </li>
            ))}
          </ul>
        )}

        <ul className="divide-y divide-slate-100">
          {rows.map((row) => {
            const badge = STATUS_BADGE[row.status];
            return (
              <li key={row.fieldId} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-slate-800">{row.label}</p>
                  {badge && <span className="text-[11px] font-medium text-amber-700">{badge}</span>}
                </div>
                {showEvidence && row.cropUrl && (
                  <img
                    src={row.cropUrl}
                    alt=""
                    aria-hidden
                    className="h-8 w-20 rounded border border-slate-200 bg-white object-contain"
                  />
                )}
                <DigitInput
                  value={row.value}
                  allowEmpty
                  onValueChange={(value) => onChange(row.fieldId, value)}
                  ariaLabel={row.label}
                  className={`h-11 w-20 rounded-lg border px-3 text-right text-base tabular-nums ${
                    row.status === "read" ? "border-slate-300" : "border-amber-400 bg-amber-50/40"
                  }`}
                />
              </li>
            );
          })}
        </ul>
      </div>
    </EditorModal>
  );
}
