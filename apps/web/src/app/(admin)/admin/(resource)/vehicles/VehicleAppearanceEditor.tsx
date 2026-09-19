"use client";
import { useState } from "react";
import type { VehiclePlateData } from "@repo/core/types";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus, faSun, faMoon, faRotate, faArrowLeft, faSliders } from "@fortawesome/free-solid-svg-icons";
import { VehicleModelPreview } from "@/lib/components/VehicleModelPreview";
import { CustomSelect } from "@/lib/components/CustomSelect";
import { APPEARANCE_PREFIX, BODY_COLOR_BASE, mapModelLabelFor, mapModelKeyForVehicle, modelChoicesFor, modelUrlFor } from "@/lib/vehicleModels";
import { orderedVehicleColors, VEHICLE_PAINT_PARTS, type VehiclePaintPart, type VehiclePartColors } from "@/lib/vehicleAppearance";

type Props = {
  manufacturer: string; brand: string; modelCode: string; modelKey: string; color: string; colors: string[];
  partColors: VehiclePartColors; plate: VehiclePlateData; partsSupported: boolean;
  onModel: (value: string) => void; onColor: (value: string) => void; onAddColor: (value: string) => void;
  onPartColors: (value: VehiclePartColors) => void;
  onDetails?: () => void; onBack?: () => void; onRetry?: () => void; detailed?: boolean; saveError?: boolean; saving?: boolean;
};
export function VehicleAppearanceEditor(props: Props) {
  const { manufacturer, brand, modelCode, modelKey, color, colors, partColors, plate, onModel, onColor, onAddColor, onPartColors, detailed, onDetails, onBack, partsSupported } = props;
  const [night, setNight] = useState(false);
  const [target, setTarget] = useState<"body" | VehiclePaintPart>("body");
  const resolved = mapModelKeyForVehicle({ manufacturer, brand, model_code: modelCode, model_key: modelKey });
  const label = mapModelLabelFor(resolved);
  const automaticLabel = mapModelLabelFor(mapModelKeyForVehicle({ manufacturer, brand, model_code: modelCode }));
  const choices = modelChoicesFor(manufacturer, brand);
  const palette = orderedVehicleColors([...BODY_COLOR_BASE, ...[...colors, color, ...Object.values(partColors)].filter(Boolean).map(value => ({ label: value, value }))]);
  const selectedColor = target === "body" ? color : partColors[target] ?? "";
  const chooseColor = (value: string) => {
    if (target === "body") onColor(value);
    else { const next = { ...partColors }; if (value) next[target] = value; else delete next[target]; onPartColors(next); }
  };
  return <section className={detailed ? "flex min-h-0 flex-1 flex-col p-4 sm:p-6" : "overflow-hidden rounded-lg border border-slate-200"} aria-label={detailed ? "外観の詳細設定" : "車両の見た目"}>
    {detailed && <header className="mb-3 flex items-center gap-2"><button type="button" onClick={onBack} disabled={props.saving} aria-label="車両情報へ戻る" className="h-11 w-11 rounded text-slate-600 hover:bg-slate-100"><FontAwesomeIcon icon={faArrowLeft} /></button><h2 className="text-lg font-semibold text-slate-900">外観の詳細設定</h2></header>}
    <div className={detailed ? "min-h-0 flex-1 overflow-y-auto" : ""}>
      <div className="flex flex-wrap items-center justify-between gap-1 border-b border-slate-100 px-3 py-1">
        {detailed && choices.length > 0 ? <div className="min-w-0 flex-1 pr-2"><CustomSelect ariaLabel="表示する車両モデル" size="md" clearable={false} value={modelKey} onChange={onModel} options={[
          { value: "", label: `${automaticLabel.label}（自動）` }, ...choices.map(a => ({ value: `${APPEARANCE_PREFIX}${a.key}`, label: a.label })),
        ]} /></div> : <span className="text-xs font-medium text-slate-600">{label.label}{label.isDefault ? "（代わりに表示）" : ""}</span>}

        <div className="flex items-center gap-1">
          {!detailed && <button type="button" onClick={onDetails} className="inline-flex min-h-11 items-center gap-1.5 rounded px-2 text-xs text-slate-600 hover:bg-slate-100"><FontAwesomeIcon icon={faSliders} />詳細設定</button>}
          <button type="button" aria-label="ライトを点ける" aria-pressed={night} onClick={() => setNight(v => !v)} className={`inline-flex min-h-11 items-center gap-1.5 rounded px-2 text-xs ${night ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
            <FontAwesomeIcon icon={night ? faMoon : faSun} className="h-3.5 w-3.5" />{night ? "夜" : "昼"}
          </button>
        </div>
      </div>
      <div className={night ? "bg-slate-200" : "bg-slate-50"}>
        <VehicleModelPreview modelUrl={modelUrlFor(resolved)} bodyColor={color || null} partColors={partColors} plate={plate} night={night} className="h-56 w-full sm:h-64" />
        <p className="flex items-center justify-center gap-1.5 pb-2 text-[11px] text-slate-500"><FontAwesomeIcon icon={faRotate} />ドラッグで回転</p>
      </div>
      {detailed && <div className="mt-3 grid grid-cols-2 gap-1 sm:grid-cols-4" role="group" aria-label="色を変える場所">
        {[{ key: "body" as const, label: "車体全体" }, ...VEHICLE_PAINT_PARTS].map(part => <button type="button" key={part.key} aria-pressed={target === part.key} disabled={part.key !== "body" && !partsSupported} onClick={() => setTarget(part.key)} className={`min-h-11 rounded border px-2 text-sm disabled:opacity-40 ${target === part.key ? "border-slate-800 bg-slate-800 text-white" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>{part.label}</button>)}
      </div>}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-slate-200 px-3 py-2">
        {!detailed && <span className="mr-1 text-xs font-medium text-slate-600">車体色</span>}
        {palette.map(c => <button key={c.value} type="button" title={c.label} aria-label={`車体色：${c.label}`} aria-pressed={selectedColor.toLowerCase() === c.value.toLowerCase()} onClick={() => chooseColor(c.value)} className="flex h-11 w-11 items-center justify-center rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-500">
          <span className={`h-7 w-7 rounded-full border border-slate-300 ${selectedColor.toLowerCase() === c.value.toLowerCase() ? "ring-2 ring-slate-800 ring-offset-2" : ""}`} style={{ backgroundColor: c.value }} />
        </button>)}
        <label className="relative flex h-11 w-11 cursor-pointer items-center justify-center rounded border border-dashed border-slate-300 text-slate-500" title="色を追加"><FontAwesomeIcon icon={faPlus} />
          <input type="color" aria-label="色を追加" value={selectedColor || color || "#ffffff"} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" onChange={e => chooseColor(e.target.value)} onBlur={e => onAddColor(e.target.value)} />
        </label>
        <button type="button" onClick={() => chooseColor("")} className="ml-auto min-h-11 rounded px-2 text-xs text-slate-500 hover:bg-slate-100">{target === "body" ? "元の色" : "個別色を解除"}</button>
      </div>
      {detailed && <>
        <p className="px-1 text-xs text-slate-500">部位に選んだ色は、車体全体の色を変えても残ります。</p>
        {!partsSupported && <p role="status" className="mt-2 rounded bg-amber-50 p-3 text-sm text-amber-900">部位ごとの色は準備中です。</p>}

      </>}
    </div>
    {detailed && <footer className="mt-3 flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
      <span role={props.saveError ? "alert" : "status"} className={`text-xs ${props.saveError ? "text-red-700" : "text-slate-500"}`}>{props.saveError ? "保存できませんでした。" : props.saving ? "保存中…" : ""}</span>
      <div className="ml-auto flex gap-2">{props.saveError && props.onRetry && <button type="button" onClick={props.onRetry} disabled={props.saving} className="min-h-11 rounded border border-slate-300 px-3 text-sm text-slate-700 disabled:opacity-50">再保存</button>}
      <button type="button" onClick={onBack} disabled={props.saving} className="min-h-11 rounded bg-slate-800 px-4 text-sm text-white disabled:opacity-50">車両情報へ戻る</button></div>
    </footer>}
  </section>;
}
