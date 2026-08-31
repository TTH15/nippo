"use client";
import { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPen, faTrashCan } from "@fortawesome/free-solid-svg-icons";
import { ParkingLocationField } from "./ParkingLocationField";
import type { ParkingLocation } from "./parking-geocoding";
import { parkingPlaceUseCount, removeParkingPlace, validateParkingPlace, type ParkingPlace } from "./model";
import { EditorModal, ErrorMessage, Field, buttonClass, inputClass, primaryClass, type PageProps } from "./ui";

// DriverBoardのラベル編集と、実画面由来のEditorModalを再利用する登録先の編集。
// 配車の入力とは別に保存し、戻るときに配車の入力内容を破棄しない。
export function ParkingPlacesEditor({ demo, setDemo, notify, confirm, onDirtyChange, onClose, selectedIds = [] }: Pick<PageProps, "demo" | "setDemo" | "notify" | "confirm"> & { onDirtyChange: (dirty: boolean) => void; onClose: () => void; selectedIds?: string[] }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [detail, setDetail] = useState("");
  const [location, setLocation] = useState<ParkingLocation>({ address: "" });
  const [locationRevision, setLocationRevision] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const markDirty = (value: boolean) => { setDirty(value); onDirtyChange(value); };
  const guard = (action: () => void) => dirty ? confirm("駐車場所の入力を破棄しますか？", "保存していない駐車場所の入力を破棄します。配車の入力内容は残ります。", action, "破棄する") : action();
  const reset = () => { setEditing(null); setName(""); setDetail(""); setLocation({ address: "" }); setLocationRevision(value => value + 1); setError(""); markDirty(false); };
  const close = () => guard(() => { markDirty(false); onClose(); });
  const save = () => {
    const place: ParkingPlace = { id: editing ?? `parking-${Date.now()}`, name: name.trim(), detail: detail.trim(), address: location.address.trim(), position: location.position };
    const issue = validateParkingPlace(demo, place);
    if (issue) { setError(issue); return; }
    setDemo({ ...demo, parkingPlaces: editing ? demo.parkingPlaces.map(item => item.id === editing ? place : item) : [...demo.parkingPlaces, place] });
    reset(); notify("駐車場所を保存しました。受取・返却場所の候補に反映されます");
  };
  return <EditorModal variant="shift" title="駐車場所を編集" onClose={close} footer={<div className="flex flex-wrap gap-2"><button type="button" className={primaryClass} onClick={save}>{editing ? "変更を保存" : "駐車場所を追加"}</button><button className={buttonClass} onClick={close}>閉じる</button></div>}>
    <form onSubmit={event => { event.preventDefault(); save(); }} className="space-y-3">
      <Field label="駐車場所の名前"><input aria-label="駐車場所の名前" placeholder="例：豊中車庫" maxLength={40} value={name} onChange={event => { setName(event.target.value); markDirty(true); setError(""); }} className={inputClass}/></Field>
      <ParkingLocationField key={locationRevision} value={location} onChange={value => { setLocation(value); markDirty(true); setError(""); }}/>
      <Field label="目印（任意）"><input aria-label="目印" placeholder="例：北側入口・区画A" maxLength={200} value={detail} onChange={event => { setDetail(event.target.value); markDirty(true); setError(""); }} className={inputClass}/></Field>
      <ErrorMessage message={error}/>
      {editing && <button type="button" className={buttonClass} onClick={() => guard(reset)}>編集をやめる</button>}
    </form>
    <div className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-200" aria-label="登録済みの駐車場所">
      {demo.parkingPlaces.map(place => {
        const count = parkingPlaceUseCount(demo, place.id);
        const selected = selectedIds.includes(place.id);
        const used = count > 0 || selected;
        return <div key={place.id} className="flex items-center gap-1 px-3 py-2">
          <div className="min-w-0 flex-1"><p className="break-words text-sm font-medium">{place.name}</p>{place.address && <p className="mt-1 break-words text-xs text-slate-500">{place.address}</p>}{place.detail && <p className="mt-1 break-words text-xs text-slate-500">{place.detail}</p>}{place.position && <p className="mt-1 text-[11px] text-slate-500">位置を登録済み</p>}{used && <p className="mt-1 text-[11px] text-slate-400">{count ? `利用記録 ${count}件` : "配車で選択中"}</p>}</div>
          <button aria-label={`${place.name}を編集`} className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-50" onClick={() => guard(() => { setEditing(place.id); setName(place.name); setDetail(place.detail); setLocation({ address: place.address ?? "", position: place.position }); setLocationRevision(value => value + 1); setError(""); markDirty(false); })}><FontAwesomeIcon icon={faPen}/></button>
          <button aria-label={`${place.name}を削除`} disabled={used} title={used ? "配車の入力・利用記録で使用中のため削除できません" : undefined} className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-30" onClick={() => confirm("駐車場所を削除しますか？", `「${place.name}」を選択候補から削除します。`, () => {
            const result = removeParkingPlace(demo, place.id, selectedIds);
            if (result.error) { setError(result.error); return; }
            setDemo(result.demo); if (editing === place.id) reset(); notify("駐車場所を削除しました");
          }, "削除する")}><FontAwesomeIcon icon={faTrashCan}/></button>
        </div>;
      })}
      {!demo.parkingPlaces.length && <p className="p-3 text-sm text-slate-500">駐車場所が未登録です。上の欄から追加してください。</p>}
    </div>
    <p className="mt-3 text-[11px] leading-5 text-slate-500">会社で共通の選択候補です。名前・住所の変更は利用記録の表示にも反映されます。使用中の場所は削除できません。</p>
  </EditorModal>;
}
