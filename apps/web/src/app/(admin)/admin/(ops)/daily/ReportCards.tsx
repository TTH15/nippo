"use client";

// 日報報告ページのスマホ用カード表示部品。
// PC はテーブル（page.tsx 内）、スマホ（< md）はこのカード群で表示する。

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCircleCheck, faPenToSquare } from "@fortawesome/free-solid-svg-icons";
import { VehiclePlate } from "@/lib/components/VehiclePlate";
import { getDisplayName } from "@/lib/displayName";
import { carrierBadgeLabel, carrierBadgeTone } from "@/lib/carrierBadge";
import { ReportContentView } from "@/lib/components/ReportContentView";
import type { ReportContentUnit } from "@/lib/reportContent";

type DriverLike = { id: string; name: string; display_name?: string | null };

type VehiclePlatePayload = {
  id: string;
  number_prefix?: string | null;
  number_class?: string | null;
  number_hiragana?: string | null;
  number_numeric?: string | null;
  manufacturer?: string | null;
  brand?: string | null;
};

type ReportLike = {
  id?: string;
  carrier?: string | null;
  carrier_name?: string | null;
  course_name?: string | null;
  content?: ReportContentUnit[];
  takuhaibin_completed?: number;
  nekopos_completed?: number;
  amazon_am_completed?: number;
  amazon_pm_completed?: number;
  amazon_4_completed?: number;
  submitted_at?: string;
  meter_value?: number | null;
  vehicle_plate?: VehiclePlatePayload | null;
};

const fmtTime = (s?: string) =>
  s ? new Date(s).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" }) : "—";

export function CarrierBadge({
  carrier,
  carrierName,
  muted,
}: {
  carrier?: string | null;
  carrierName?: string | null;
  muted?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center justify-center px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap ${carrierBadgeTone(carrier, carrierName, muted)}`}
    >
      {carrierBadgeLabel(carrier, carrierName)}
    </span>
  );
}

/** 配送内容。送信画面と同じ動的 unit/field 構造で表示する。 */
export function ReportContent({ r, muted }: { r: ReportLike; muted?: boolean }) {
  return <ReportContentView units={r.content} muted={muted} />;
}

function hasPlate(p?: VehiclePlatePayload | null): p is VehiclePlatePayload {
  return !!p && !!(p.number_prefix || p.number_hiragana || p.number_numeric);
}

function CardShell({ muted, children }: { muted?: boolean; children: React.ReactNode }) {
  return (
    <div className={`rounded-lg border p-3 ${muted ? "border-slate-200 bg-slate-50" : "border-slate-200 bg-white"}`}>
      {children}
    </div>
  );
}

/** 未承認タブ用カード（ドライバー単位・reps 配列）。 */
export function PendingDriverCard({
  driver,
  reps,
  status,
  needsProxy,
  canWrite,
  onApprove,
  onReject,
  onEdit,
  onProxyEntry,
}: {
  driver: DriverLike;
  reps: ReportLike[];
  status: "off" | "unsubmitted" | "approved" | "pending";
  /** 担当コースの一部だけ未提出 → 代理入力が必要（承認済みでもボタンを出す） */
  needsProxy?: boolean;
  canWrite: boolean;
  onApprove: () => void;
  onReject: () => void;
  onEdit: (rep: ReportLike) => void;
  onProxyEntry?: () => void;
}) {
  // 提出済み分は承認済みでも、他コースが未提出のままなら「対応済み」表示にしない
  const isResolved = status === "approved" && !needsProxy;
  const muted = status === "off" || isResolved;
  // unsubmitted 以外でも未提出コースが残っていれば代理入力を出す（1日複数コース対応）
  const showProxy = canWrite && !!onProxyEntry && !!needsProxy;
  return (
    <CardShell muted={muted}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-slate-900">{getDisplayName(driver)}</span>
        <div className="flex items-center gap-2">
          {isResolved && (
            <span className="inline-flex items-center px-2 h-6 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-700">
              <FontAwesomeIcon icon={faCircleCheck} className="mr-1" />
              承認済み
            </span>
          )}
          {status === "approved" && needsProxy && (
            <span className="inline-flex items-center px-2 h-6 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-700">
              一部未提出
            </span>
          )}
          {status === "unsubmitted" && (
            <span className="text-red-600 text-xs font-semibold">日報が未提出です</span>
          )}
          {status === "off" && reps.length === 0 && <span className="text-slate-500 text-xs">休み</span>}
          {showProxy && (
            <button
              type="button"
              onClick={onProxyEntry}
              className="inline-flex items-center whitespace-nowrap px-3 py-1 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200"
            >
              代理入力
            </button>
          )}
        </div>
      </div>

      {showProxy && reps.length > 0 && (
        <p className="mt-2 text-[11px] font-semibold text-red-600">未提出のコースがあります</p>
      )}

      {reps.length > 0 && (
        <div className="mt-2 space-y-2.5">
          {reps.map((r) => (
            <div key={r.id} className="border-t border-slate-100 pt-2 first:border-t-0 first:pt-0">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <CarrierBadge carrier={r.carrier} carrierName={r.carrier_name} muted={muted} />
                  {r.course_name && <span className="truncate text-xs text-slate-500">{r.course_name}</span>}
                </div>
                <span className="text-[11px] text-slate-400 tabular-nums shrink-0">{fmtTime(r.submitted_at)} 送信</span>
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                {hasPlate(r.vehicle_plate) ? (
                  <VehiclePlate vehicle={r.vehicle_plate} compact className="max-w-[150px]" />
                ) : (
                  <span className="text-xs text-slate-400">車両 —</span>
                )}
                {r.meter_value != null && (
                  <span className="text-xs tabular-nums text-slate-600">
                    {r.meter_value.toLocaleString()}
                    <span className="text-[10px] text-slate-500 ml-0.5">km</span>
                  </span>
                )}
              </div>
              <div className="mt-1.5 flex items-center justify-between gap-2">
                <ReportContent r={r} muted={muted} />
                {canWrite && (status === "pending" || status === "approved") && (
                  <button
                    type="button"
                    onClick={() => onEdit(r)}
                    className="shrink-0 text-slate-500 hover:text-slate-900"
                    aria-label="編集"
                  >
                    <FontAwesomeIcon icon={faPenToSquare} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {status === "pending" && canWrite && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onApprove}
            className="py-2 rounded-lg text-[13px] font-semibold bg-slate-800 text-white hover:bg-slate-700"
          >
            承認
          </button>
          <button
            type="button"
            onClick={onReject}
            className="py-2 rounded-lg text-[13px] font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200"
          >
            却下
          </button>
        </div>
      )}
    </CardShell>
  );
}

/** すべてタブ用カード（報告単位）。 */
export function AllReportCard({
  driver,
  report,
  approved,
  rejected,
  canWrite,
  showEdit,
  onApprove,
  onReject,
  onEdit,
}: {
  driver: DriverLike;
  report: ReportLike;
  approved: boolean;
  rejected: boolean;
  canWrite: boolean;
  showEdit: boolean;
  onApprove: () => void;
  onReject: () => void;
  onEdit: () => void;
}) {
  return (
    <CardShell>
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-slate-900">{getDisplayName(driver)}</span>
        <div className="flex items-center gap-2 min-w-0">
          {report.course_name && <span className="truncate text-xs text-slate-500">{report.course_name}</span>}
          <CarrierBadge carrier={report.carrier} carrierName={report.carrier_name} />
        </div>
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <ReportContent r={report} />
        <span className="text-[11px] text-slate-400 tabular-nums shrink-0">{fmtTime(report.submitted_at)} 送信</span>
      </div>
      <div className="mt-2.5 flex items-center justify-between gap-2">
        <div>
          {approved ? (
            <span className="inline-flex items-center px-2 h-6 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-700">
              <FontAwesomeIcon icon={faCircleCheck} className="mr-1" />
              承認済み
            </span>
          ) : rejected ? (
            <span className="inline-flex items-center px-2 h-6 rounded-full text-[11px] font-semibold bg-rose-100 text-rose-700">
              却下
            </span>
          ) : canWrite ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onApprove}
                className="px-4 py-1.5 rounded-full text-[12px] font-semibold bg-slate-800 text-white hover:bg-slate-700"
              >
                承認
              </button>
              <button
                type="button"
                onClick={onReject}
                className="px-4 py-1.5 rounded-full text-[12px] font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200"
              >
                却下
              </button>
            </div>
          ) : (
            <span className="text-slate-400 text-xs">未承認</span>
          )}
        </div>
        {showEdit && canWrite && (
          <button
            type="button"
            onClick={onEdit}
            className="shrink-0 text-slate-500 hover:text-slate-900"
            aria-label="編集"
          >
            <FontAwesomeIcon icon={faPenToSquare} />
          </button>
        )}
      </div>
    </CardShell>
  );
}
