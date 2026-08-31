"use client";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { SmoothCollapse } from "@/lib/components/SmoothCollapse";
import { PREVIEW_MAPBOX_ENABLED } from "./mapbox-config";
import { searchParkingAddresses, type AddressHit, type ParkingLocation } from "./parking-geocoding";
import { ErrorMessage, Field, buttonClass, inputClass } from "./ui";

const ParkingMap = lazy(() => import("./ParkingMap").then(module => ({ default: module.ParkingMap })));

export function ParkingLocationField({ value, onChange }: { value: ParkingLocation; onChange: (value: ParkingLocation) => void }) {
  const [open, setOpen] = useState(false);
  const [hits, setHits] = useState<AddressHit[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  const cancel = () => { request.current?.abort(); request.current = null; setLoading(false); };
  useEffect(() => () => request.current?.abort(), []);
  const search = async () => {
    if (!PREVIEW_MAPBOX_ENABLED) return;
    cancel(); setHits([]); setSearched(false); setError("");
    const controller = new AbortController(); request.current = controller; setLoading(true);
    const timeout = setTimeout(() => {
      if (request.current !== controller) return;
      cancel(); setError("検索がタイムアウトしました。通信状態を確認して再検索してください。");
    }, 10000);
    try {
      const found = await searchParkingAddresses(value.address, controller.signal);
      if (request.current !== controller || controller.signal.aborted) return;
      setHits(found); setSearched(true);
    } catch (issue) {
      if (request.current === controller && !controller.signal.aborted) setError(issue instanceof TypeError ? "住所を検索できません。通信状態を確認して再検索してください。" : issue instanceof Error ? issue.message : "住所を検索できませんでした。");
    } finally {
      clearTimeout(timeout);
      if (request.current === controller) { setLoading(false); request.current = null; }
    }
  };
  const changeAddress = (address: string) => { cancel(); setHits([]); setSearched(false); setError(""); onChange({ address }); };
  return <section aria-label="駐車場所の住所と地図" className="space-y-3">
    <Field label="住所"><div className="flex gap-2">
      <input aria-label="駐車場所の住所" placeholder="例：大阪府豊中市中桜塚3丁目1番1号" maxLength={256} value={value.address} onChange={event => changeAddress(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); void search(); } }} className={inputClass + " min-w-0 flex-1"}/>
      <button type="button" className={buttonClass + " shrink-0"} disabled={!PREVIEW_MAPBOX_ENABLED || loading || !value.address.trim()} onClick={() => void search()}>{loading ? "検索中…" : "住所を検索"}</button>
    </div></Field>
    {PREVIEW_MAPBOX_ENABLED ? <p className="text-[11px] leading-5 text-slate-500">検索時は住所を、地図表示時は表示範囲をMapboxへ送信します。Mapboxの利用料が発生する場合があります。</p> : <p className="text-[11px] leading-5 text-slate-500">地図・住所検索はMapbox接続モードで利用できます。現在は外部送信なしのプレビューです。</p>}
    <ErrorMessage message={error}/>
    {hits.length > 0 && <div aria-label="住所の検索結果" className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200">{hits.map(hit => <button type="button" key={hit.id} className="min-h-11 w-full px-3 py-3 text-left text-sm text-slate-700 hover:bg-amber-50" onClick={() => { onChange({ address: hit.address, position: { lat: hit.lat, lng: hit.lng } }); setHits([]); setSearched(false); setOpen(true); }}>{hit.address}</button>)}</div>}
    {searched && !hits.length && <p role="status" className="text-xs text-slate-600">住所が見つかりません。市区町村・番地を変えて検索するか、地図で場所を指定してください。</p>}
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" className={buttonClass + " text-xs"} disabled={!PREVIEW_MAPBOX_ENABLED} aria-expanded={open} onClick={() => setOpen(previous => !previous)}>{open ? "地図を閉じる" : value.position ? "地図で位置を確認" : "地図で場所を指定"}</button>
      {value.position && <><span className="text-[11px] tabular-nums text-slate-500" aria-label="ピンの座標">{value.position.lat.toFixed(6)}, {value.position.lng.toFixed(6)}</span><button type="button" className="min-h-11 text-xs text-slate-500 underline" onClick={() => { cancel(); setHits([]); setSearched(false); onChange({ address: "" }); }}>位置をクリア</button></>}
    </div>
    <SmoothCollapse open={open && PREVIEW_MAPBOX_ENABLED}><Suspense fallback={<p role="status" className="text-xs text-slate-500">地図を準備しています…</p>}><ParkingMap position={value.position} onChange={position => onChange({ ...value, position })}/></Suspense></SmoothCollapse>
  </section>;
}
