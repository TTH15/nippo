"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ParkingPlaceOption } from "@repo/core/types";
import ReportParkingMap from "@/lib/map/ReportParkingMap";
import { getParkingFix, getParkingPermission, usableParkingFix, validParkingPoint, type DeviceFix, type MapPoint } from "@/lib/map/reportParkingLocation";
import { EditorModal } from "@/lib/components/EditorModal";
import { ParkingPlaceSearch } from "./ParkingPlaceSearch";

export type ParkingChoice = { placeId: string | null; slotId: string | null; pin: MapPoint | null; note: string; time: string; nextDay: boolean };
export const EMPTY_PARKING_CHOICE: ParkingChoice = { placeId: null, slotId: null, pin: null, note: "", time: "", nextDay: false };
const EMPTY_PLACES: ParkingPlaceOption[] = [];
const buttonClass = "min-h-11 rounded-lg border px-2.5 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900";
const choiceTone = (selected: boolean) => selected
  ? "border-slate-900 bg-slate-100 font-semibold text-slate-950 ring-1 ring-inset ring-slate-900"
  : "border-slate-300 bg-white text-slate-700";

export function ParkingLocationForm({ places = EMPTY_PLACES, loading, lookupError = false, locatingAllowed, value, error, onConfirm }: {
  places?: ParkingPlaceOption[]; loading: boolean; lookupError?: boolean; locatingAllowed: boolean; value: ParkingChoice;
  error: string | null; onConfirm: (choice: ParkingChoice) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [fix, setFix] = useState<DeviceFix | null>(null);
  const shouldLocate = locatingAllowed && !value.placeId && !value.pin;
  const [locating, setLocating] = useState(shouldLocate);
  const [attempted, setAttempted] = useState(false);
  const [mapStatus, setMapStatus] = useState<"loading" | "ready" | "unavailable">("loading");
  const [slotPlaceId, setSlotPlaceId] = useState<string | null>(null);
  const [cameraPlace, setCameraPlace] = useState<ParkingPlaceOption | null>(null);
  const [permission, setPermission] = useState<PermissionState | null>(null);
  const interacted = useRef(false);
  const attemptRef = useRef(0);
  const firstFix = useRef<Promise<DeviceFix | null> | null>(null);
  const locate = useCallback(async (initial = false) => {
    if (!shouldLocate) return;
    const attempt = ++attemptRef.current;
    setLocating(true);
    setAttempted(true);
    try {
      // Development/preview StrictMode can re-run the effect. Reuse the one browser request.
      const request = initial ? (firstFix.current ??= getParkingFix()) : getParkingFix();
      const result = await request;
      if (attempt !== attemptRef.current || interacted.current) return;
      if (usableParkingFix(result)) setFix(result);
      else {
        const state = await getParkingPermission();
        if (attempt === attemptRef.current) setPermission(state);
      }
    } catch {
      if (attempt === attemptRef.current) setPermission(null);
    } finally {
      if (attempt === attemptRef.current) setLocating(false);
    }
  }, [shouldLocate]);
  useEffect(() => {
    if (shouldLocate) void locate(true);
    return () => { ++attemptRef.current; };
  }, [locate, shouldLocate]);
  const slotPlace = places.find(p => p.id === slotPlaceId);
  const chosen = places.find(p => p.id === draft.placeId);
  const center = useMemo(() => {
    const oldPlace = places.find(p => p.id === value.placeId);
    return cameraPlace ?? value.pin ?? (oldPlace && validParkingPoint(oldPlace) ? oldPlace : fix) ?? places.find(validParkingPoint) ?? null;
  }, [cameraPlace, fix, places, value.pin, value.placeId]);
  const confirmable = (!!chosen || !!(draft.pin && validParkingPoint(draft.pin))) && (locatingAllowed || /^([01]\d|2[0-3]):[0-5]\d$/.test(draft.time));
  function applyPlace(placeId: string, slotId: string | null) {
    setDraft(x => ({ ...x, placeId, slotId, pin: null }));
    setSlotPlaceId(null);
  }
  function choosePlace(place: ParkingPlaceOption) {
    interacted.current = true;
    if (place.slots.length) setSlotPlaceId(place.id);
    else applyPlace(place.id, null);
  }
  function findPlace(place: ParkingPlaceOption) {
    interacted.current = true;
    if (mapStatus === "unavailable" || !validParkingPoint(place)) choosePlace(place);
    else setCameraPlace({ ...place });
  }
  const selectedSlot = chosen?.slots.find(slot => slot.id === draft.slotId);
  const locationLabel = chosen ? [chosen.name, selectedSlot?.label].filter(Boolean).join(" · ") : draft.pin ? "地図のピン" : null;
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="relative isolate min-h-0 flex-1 overflow-hidden bg-slate-100">
      <ReportParkingMap center={center} currentFix={fix} pin={draft.pin} places={places} selectedPlaceId={draft.placeId}
        onStatus={setMapStatus} onPlace={id => { const place = places.find(p => p.id === id); if (place) choosePlace(place); }}
        onPin={pin => { if (validParkingPoint(pin)) { interacted.current = true; setDraft(x => ({ ...x, placeId: null, slotId: null, pin })); } }} />
      {places.length > 0 && <ParkingPlaceSearch places={places} showAll={mapStatus === "unavailable"} onChoose={findPlace} />}
    </div>
    {slotPlace && <EditorModal title="区画を選ぶ" variant="setup" trapFocus onClose={() => setSlotPlaceId(null)}>
      <p className="mb-3 text-sm font-medium text-slate-700">{slotPlace.name}</p>
      <div className="grid grid-cols-2 gap-2" role="group" aria-label={`${slotPlace.name}の区画`}>
        {slotPlace.slots.map(slot => {
          const selected = draft.placeId === slotPlace.id && draft.slotId === slot.id;
          return <button key={slot.id} type="button" aria-pressed={selected} className={`${buttonClass} ${choiceTone(selected)}`}
            onClick={() => applyPlace(slotPlace.id, slot.id)}>{slot.label}</button>;
        })}
      </div>
    </EditorModal>}
    <footer className="flex max-h-[62%] shrink-0 flex-col border-t border-slate-200 bg-white">
        <div className="mx-auto flex min-h-0 w-full max-w-lg flex-col gap-2 px-4 pb-4 pt-3">
          <section className="min-h-0 space-y-2 overflow-y-auto overscroll-contain" aria-label="返却の詳細">
            {locating && <span className="sr-only" role="status">現在地を確認中</span>}
            {shouldLocate && attempted && !locating && !fix && !chosen && !draft.pin && (
              <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
                <span role="status">{permission === "denied" ? "ブラウザの設定で位置情報を許可してください。" : "現在地を確認できません。"}</span>
                <button type="button" className={`${buttonClass} border-slate-300 bg-white`} onClick={() => void locate()}>位置情報を再取得</button>
              </div>
            )}
            {loading && <span className="sr-only" role="status">登録場所を読み込み中</span>}
            {lookupError && <p role="status" className="text-sm text-slate-700">登録場所を読み込めません。地図にピンを置いてください。</p>}
            {locationLabel && <div className="flex min-h-11 items-center justify-between gap-2">
              <p title={locationLabel} className="line-clamp-2 min-w-0 break-words text-sm font-semibold leading-5 text-slate-900">{locationLabel}</p>
              {chosen && chosen.slots.length > 0 && <button type="button" className="min-h-11 shrink-0 px-1 text-sm font-medium underline" onClick={() => setSlotPlaceId(chosen.id)}>区画を変更</button>}
            </div>}
            <span className="sr-only" aria-live="polite">{draft.pin ? "地図のピンを選択中" : ""}</span>
            {!locatingAllowed && <div className="grid grid-cols-2 gap-2 text-sm font-medium text-slate-800">
              <label className="space-y-1">
                <span>駐車日</span>
                <select value={draft.nextDay ? "next" : "same"} onChange={e => setDraft(x => ({ ...x, nextDay: e.target.value === "next" }))}
                  className="block min-h-11 w-full rounded-lg border border-slate-300 px-2">
                  <option value="same">日報の日</option><option value="next">日報の翌日</option>
                </select>
              </label>
              <label className="space-y-1">
                <span>駐車時刻</span>
                <input type="time" aria-required="true" value={draft.time} onChange={e => setDraft(x => ({ ...x, time: e.target.value }))}
                  className="block min-h-11 w-full rounded-lg border border-slate-300 px-2" />
              </label>
            </div>}
            {(chosen || draft.pin) && <input type="text" className="min-h-11 w-full rounded-lg border border-slate-300 px-3 text-sm" aria-label="メモ（任意）"
              placeholder="メモ（任意）" value={draft.note} maxLength={200} onChange={e => setDraft(x => ({ ...x, note: e.target.value }))} />}
            {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          </section>
          <button type="button" disabled={!confirmable}
            className="min-h-12 w-full shrink-0 rounded-xl bg-slate-900 px-3 font-semibold text-white disabled:bg-slate-200 disabled:text-slate-600"
            onClick={() => { if (confirmable) onConfirm(draft); }}>ここに返却</button>
        </div>
    </footer>
  </div>;
}
