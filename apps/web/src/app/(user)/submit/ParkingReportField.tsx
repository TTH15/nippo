"use client";

// ============================================================
// 日報の「車の置き場所」（駐車申告）。設計: docs/design/daily-report-parking-foundation.md
// 使用車両を選んだときだけ出す。登録車庫（区画があれば区画も）か「別の場所」を選ぶか、
// 「まだ使用中」「次の人に渡した」「あとで記録」を選ぶ。いつもの区画がある車庫は先頭に出すが、
// 停めた場所として勝手に確定しない。
// ============================================================
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faWarehouse, faSquareParking, faLocationDot, faTruckFast, faHandshake, faClock } from "@fortawesome/free-solid-svg-icons";
import type { ParkingPlaceOption, ParkingReportStatus } from "@repo/core/types";

export type ParkingChoice = {
  /** null = 未回答 */
  status: ParkingReportStatus | null;
  placeId: string | null;
  slotId: string | null;
  /** 「別の場所」を選んでいるか（placeId と排他） */
  other: boolean;
  placeName: string;
  note: string;
};

export const EMPTY_PARKING_CHOICE: ParkingChoice = { status: null, placeId: null, slotId: null, other: false, placeName: "", note: "" };

/** 送信できる状態か。parked は場所（車庫 or 名前）が要る */
export function parkingChoiceError(choice: ParkingChoice): string | null {
  if (choice.status === null) return "車の置き場所を選んでください";
  if (choice.status !== "parked") return null;
  if (choice.other) return choice.placeName.trim() ? null : "場所の名前を入れてください";
  return choice.placeId ? null : "停めた車庫を選んでください";
}

const chip = (active: boolean) =>
  `inline-flex items-center gap-1.5 rounded-full border px-3 py-2 text-sm font-medium transition-colors ${
    active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-slate-400"
  }`;

export function ParkingReportField({
  places,
  loading,
  vehicleId,
  choice,
  onChange,
  error,
}: {
  places: ParkingPlaceOption[];
  loading: boolean;
  vehicleId: string;
  choice: ParkingChoice;
  onChange: (next: ParkingChoice) => void;
  error: string | null;
}) {
  // いつもの区画（parking_slots.vehicle_id）がある車庫を先頭に出す
  const usualPlaceId = places.find((p) => p.slots.some((s) => s.vehicleId === vehicleId))?.id ?? null;
  const ordered = usualPlaceId ? [...places].sort((a, b) => (a.id === usualPlaceId ? -1 : b.id === usualPlaceId ? 1 : 0)) : places;
  const selectedPlace = choice.placeId ? places.find((p) => p.id === choice.placeId) ?? null : null;

  const choosePlace = (placeId: string) => {
    const place = places.find((p) => p.id === placeId);
    const usualSlot = place?.slots.find((s) => s.vehicleId === vehicleId) ?? null;
    onChange({ ...choice, status: "parked", placeId, slotId: usualSlot?.id ?? null, other: false });
  };
  const chooseOther = () => onChange({ ...choice, status: "parked", placeId: null, slotId: null, other: true });
  const chooseStatus = (status: Exclude<ParkingReportStatus, "parked">) =>
    onChange({ ...choice, status: choice.status === status ? null : status, placeId: null, slotId: null, other: false });

  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-2">車の置き場所</label>
      <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3">
        <div className="flex flex-wrap gap-2">
          {loading && places.length === 0 && <span className="text-xs text-slate-400">車庫を読み込み中…</span>}
          {ordered.map((place) => {
            const active = choice.status === "parked" && choice.placeId === place.id;
            const usual = place.id === usualPlaceId;
            return (
              <button key={place.id} type="button" className={chip(active)} onClick={() => choosePlace(place.id)} aria-pressed={active}>
                <FontAwesomeIcon icon={place.icon === "parking" ? faSquareParking : faWarehouse} className="h-3.5 w-3.5" />
                {place.name}
                {usual && <span className={`rounded-full px-1.5 py-px text-[10px] font-bold ${active ? "bg-white/20 text-white" : "bg-amber-100 text-amber-800"}`}>いつもの</span>}
              </button>
            );
          })}
          <button type="button" className={chip(choice.status === "parked" && choice.other)} onClick={chooseOther} aria-pressed={choice.status === "parked" && choice.other}>
            <FontAwesomeIcon icon={faLocationDot} className="h-3.5 w-3.5" />
            別の場所
          </button>
        </div>

        {selectedPlace && selectedPlace.slots.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-slate-500">区画</span>
            {selectedPlace.slots.map((slot) => {
              const active = choice.slotId === slot.id;
              return (
                <button
                  key={slot.id}
                  type="button"
                  aria-pressed={active}
                  className={`rounded-lg border px-2.5 py-1.5 text-sm tabular-nums ${active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700"}`}
                  onClick={() => onChange({ ...choice, slotId: active ? null : slot.id })}
                >
                  {slot.label}
                </button>
              );
            })}
          </div>
        )}

        {choice.status === "parked" && choice.other && (
          <input
            type="text"
            value={choice.placeName}
            maxLength={80}
            placeholder="場所の名前（例: 駅前コインパーキング）"
            onChange={(e) => onChange({ ...choice, placeName: e.target.value })}
            className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        )}

        {choice.status === "parked" && (
          <input
            type="text"
            value={choice.note}
            maxLength={200}
            placeholder="鍵の場所・目印（任意）"
            onChange={(e) => onChange({ ...choice, note: e.target.value })}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        )}

        <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
          <button type="button" className={chip(choice.status === "in_use")} onClick={() => chooseStatus("in_use")} aria-pressed={choice.status === "in_use"}>
            <FontAwesomeIcon icon={faTruckFast} className="h-3.5 w-3.5" />
            まだ使用中
          </button>
          <button type="button" className={chip(choice.status === "handed_over")} onClick={() => chooseStatus("handed_over")} aria-pressed={choice.status === "handed_over"}>
            <FontAwesomeIcon icon={faHandshake} className="h-3.5 w-3.5" />
            次の人に渡した
          </button>
          <button type="button" className={chip(choice.status === "later")} onClick={() => chooseStatus("later")} aria-pressed={choice.status === "later"}>
            <FontAwesomeIcon icon={faClock} className="h-3.5 w-3.5" />
            あとで記録
          </button>
        </div>
        {error && <p className="text-xs text-red-500">！{error}</p>}
      </div>
    </div>
  );
}
