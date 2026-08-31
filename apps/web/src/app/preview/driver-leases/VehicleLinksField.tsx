"use client";
import { format } from "date-fns";
import { DatePicker } from "@/lib/components/DatePicker";
import { SmoothCollapse } from "@/lib/components/SmoothCollapse";
import { VehiclePlatePicker } from "@/lib/components/VehiclePlatePicker";
import { useState } from "react";
import { DATES, linkedVehicleId, type Demo, type Driver } from "./model";
import { demoPlateData, Field } from "./ui";

// 契約料金と独立した日付付きの紐付け。元の配車予定は編集しない。
export function VehicleLinksField({ demo, driver, date, vehicleId, onDateChange, onVehicleChange }: { demo: Demo; driver: Driver; date: string; vehicleId: string; onDateChange: (date: string) => void; onVehicleChange: (id: string) => void }) {
  const [showHistory, setShowHistory] = useState(false);
  const changes = [...(driver.vehicleChanges ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  const history = changes.some(change => change.date === DATES[0]) ? changes : [{ date: DATES[0], vehicleId: driver.vehicleId }, ...changes];
  const others = demo.drivers.filter(person => vehicleId && person.id !== driver.id && linkedVehicleId(person, date) === vehicleId);
  return <section className="space-y-3 border-t border-slate-100 pt-4" aria-label="普段使う車両の紐付け">
    <div className="w-full sm:max-w-xs">
      <Field label="紐付けの変更日"><DatePicker className="h-14 w-full" ariaLabel="紐付けの変更日" value={new Date(date + "T12:00:00")} fromDate={new Date(DATES[0] + "T12:00:00")} toDate={new Date(DATES[DATES.length - 1] + "T12:00:00")} onChange={value => value && onDateChange(format(value, "yyyy-MM-dd"))}/></Field>
    </div>
    <Field label="普段使う車両"><VehiclePlatePicker label="普段使う車両" value={vehicleId} onChange={onVehicleChange} emptyLabel="紐付けなし" options={demo.vehicles.map(vehicle => ({ vehicle: demoPlateData(vehicle), name: vehicle.model, description: vehicle.unavailable ? "整備中・配車不可（紐付けは可能）" : undefined }))}/></Field>
    <p className="text-xs leading-5 text-slate-500">紐付けは車両を予約するものではありません。代車・一時借用は、その日のシフトで選択できます。</p>
    {others.length > 0 && <p className="text-xs leading-5 text-amber-800">同じ日の紐付け：{others.map(person => person.name).join("、")}。実際の二重配車はシフトで防ぎます。</p>}
    <button type="button" className="min-h-11 text-xs text-slate-500 underline underline-offset-4" aria-expanded={showHistory} aria-controls={`vehicle-link-history-${driver.id}`} onClick={() => setShowHistory(open => !open)}>保存済みの紐付け履歴</button>
    <SmoothCollapse open={showHistory} id={`vehicle-link-history-${driver.id}`}><ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 px-3 text-xs" aria-label="紐付け履歴">{history.map((change, index) => <li key={change.date} className="py-3 leading-5"><span className="block text-slate-500">{change.date} から{history[index + 1] ? ` ${history[index + 1].date} の変更前まで` : ""}</span>{demo.vehicles.find(vehicle => vehicle.id === change.vehicleId)?.plate ?? "紐付けなし"}</li>)}</ul></SmoothCollapse>
  </section>;
}
