"use client";

// ============================================================
// 車両の詳細カード（車種・稼働・オイル交換の残り・走行距離・次回車検・最後の記録）。
//
// もとは地図の吹き出し専用だったが、運営はシフト表や車両一覧でも同じことを知りたい。
// ナンバープレートの長押しで出す共通シートと地図の吹き出しで、この1つを共用する
// （2026-09-08 ユーザー依頼）。文字は最小限にし、アイコンで示す。
// ============================================================

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCalendarCheck,
  faClock,
  faGaugeHigh,
  faHand,
  faOilCan,
  faSquareParking,
  faUser,
} from "@fortawesome/free-solid-svg-icons";
import { VehiclePlate, type VehiclePlateData } from "@/lib/components/VehiclePlate";

/** 最後に位置が記録されたときの状況。地図の vehicle_positions 由来 */
export type VehicleDetailPosition = {
  at: string | null;
  kind?: "checkin" | "checkout" | "manual" | "gps" | "report";
  source?: "punch" | "manual" | "gps" | "report";
  placedBy?: string;
  note?: string | null;
  /** 日報の駐車申告なら場所名 */
  placeName?: string | null;
  sessionStatus: "open" | "closed";
  driverName: string;
};

export type VehicleDetail = VehiclePlateData & {
  next_shaken_date?: string | null;
  position?: VehicleDetailPosition | null;
};

function formatAt(at: string | null | undefined): string {
  if (!at) return "";
  const d = new Date(at);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes(),
  ).padStart(2, "0")}`;
}

function formatShakenMonth(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  return y && m ? `${y}年${m}月` : iso;
}

export function VehicleDetailCard({
  vehicle,
  className = "w-[216px]",
}: {
  vehicle: VehicleDetail;
  className?: string;
}) {
  const p = vehicle.position ?? null;
  const working = p?.sessionStatus === "open";
  const model = [vehicle.manufacturer, vehicle.brand].filter(Boolean).join(" ");
  const interval = vehicle.oil_change_interval ?? 0;
  const oilTracked = !vehicle.is_ev && interval > 0 && typeof vehicle.current_mileage === "number";
  const oilRemaining = oilTracked
    ? (vehicle.last_oil_change_mileage ?? 0) + interval - (vehicle.current_mileage ?? 0)
    : null;
  // バーは車両一覧と同じ「前回交換からどれだけ進んだか」（右端＝次回交換）。色も一覧と同じ閾値
  const oilRatio = oilRemaining === null
    ? 0
    : Math.max(0, Math.min(1, ((vehicle.current_mileage ?? 0) - (vehicle.last_oil_change_mileage ?? 0)) / interval));
  const oilTone = oilRemaining === null ? ""
    : oilRemaining < 100 ? "text-red-600" : oilRemaining <= 300 ? "text-yellow-500" : "text-slate-900";
  const oilBar = oilRemaining === null ? ""
    : oilRemaining < 100 ? "bg-red-500" : oilRemaining <= 300 ? "bg-yellow-400" : "bg-green-500";

  const recordIcon = p?.source === "report" ? faSquareParking : p?.source === "manual" ? faHand : faClock;
  const recordTitle = p?.source === "report"
    ? `日報で申告した置き場所${p.placedBy ? `（${p.placedBy}）` : ""}`
    : p?.source === "manual"
      ? `手動で配置${p.placedBy ? `（${p.placedBy}）` : ""}`
      : `${p?.kind === "checkout" ? "退勤" : "出勤"}打刻の位置`;

  const row = "flex items-center gap-2 text-[12px] tabular-nums";
  const icon = "h-3.5 w-3.5 shrink-0 text-slate-400";
  // 札のオイル警告バッジ（吹き出し付き）は下のバーと二重になり本文に被るので、札には走行距離を渡さない
  const plateOnly: VehiclePlateData = {
    ...vehicle,
    current_mileage: undefined,
    last_oil_change_mileage: undefined,
    oil_change_interval: undefined,
  };

  return (
    <div className={`${className} space-y-2 p-1 text-slate-900`}>
      <div className="flex items-center gap-2">
        <VehiclePlate vehicle={plateOnly} compact glow={false} className="w-[72px] shrink-0" />
        <div className="min-w-0">
          <div className="truncate text-[13px] font-bold">{model || "車種 未登録"}</div>
          <div
            className="flex items-center gap-1 text-[11px] text-slate-600"
            title={working ? "稼働中" : "稼働外"}
          >
            <span className={`inline-block h-2 w-2 rounded-full ${working ? "bg-emerald-500" : "bg-slate-400"}`} />
            {working && p?.driverName ? (
              <span className="inline-flex items-center gap-1 truncate">
                <FontAwesomeIcon icon={faUser} className="h-2.5 w-2.5" />
                {p.driverName}
              </span>
            ) : (
              <span>{working ? "稼働中" : "稼働外"}</span>
            )}
          </div>
        </div>
      </div>

      {oilRemaining !== null && (
        <div className="space-y-1" title="オイル交換までの残り">
          <div className={row}>
            <FontAwesomeIcon icon={faOilCan} className={icon} />
            <span className={`font-bold ${oilTone}`}>
              {oilRemaining < 0
                ? `−${Math.abs(oilRemaining).toLocaleString("ja-JP")}`
                : oilRemaining.toLocaleString("ja-JP")} km
            </span>
          </div>
          <div className="ml-[22px] h-1.5 overflow-hidden rounded-full bg-slate-200">
            <div className={`h-full rounded-full ${oilBar}`} style={{ width: `${Math.round(oilRatio * 100)}%` }} />
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        {typeof vehicle.current_mileage === "number" && (
          <div className={row} title="走行距離">
            <FontAwesomeIcon icon={faGaugeHigh} className={icon} />
            <span>{vehicle.current_mileage.toLocaleString("ja-JP")} km</span>
          </div>
        )}
        {vehicle.next_shaken_date && (
          <div className={row} title="次回車検">
            <FontAwesomeIcon icon={faCalendarCheck} className={icon} />
            <span>{formatShakenMonth(vehicle.next_shaken_date)}</span>
          </div>
        )}
      </div>

      {p ? (
        <div className={`${row} text-slate-600`} title={recordTitle}>
          <FontAwesomeIcon icon={recordIcon} className={icon} />
          <span>{formatAt(p.at)}</span>
          {p.source === "report" && p.placeName && (
            <span className="truncate font-medium text-slate-800">{p.placeName}</span>
          )}
          {p.note && <span className="truncate text-[11px] text-slate-500">{p.note}</span>}
        </div>
      ) : (
        <div className={`${row} text-slate-500`}>
          <FontAwesomeIcon icon={faClock} className={icon} />
          <span>まだ位置の記録がありません</span>
        </div>
      )}
    </div>
  );
}
