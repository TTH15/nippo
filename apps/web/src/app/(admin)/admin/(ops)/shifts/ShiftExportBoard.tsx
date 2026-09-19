"use client";

import { VehiclePlate } from "@/lib/components/VehiclePlate";
import type { ShiftExportCell, ShiftExportData } from "@/lib/shiftExport/data";
import type { ExportCell } from "@/lib/shiftExport/selection";

// ============================================================
// シフト表の出力盤面。画面に出しているものをそのまま画像にする（配車画像化と同じ考え方）。
//   旧 shiftPdf.ts は A4横1枚へ座標を手で置いていたため、
//     ・ナンバープレートが文字列（"京都 481 り 65-47"）
//     ・日数が増えるほど全体が縮んで読めない
//   という制約があった。ここでは実物のプレートを描き、枚数で分ける。
//
//   選ぶとき（interactive）は表全体を出し、範囲の外をグレーにする。
//   画像にするときは選んだぶんだけを渡す（グレーの行・列は入らない）。
//
//   画像化のための目印（captureShiftImage が使う）:
//     data-export-plate … プレート面。複製後に画像へ差し替える
//     data-export-omit  … 画像には残さない要素
// ============================================================

const DRIVER_COL = 104;
const DAY_COL = 148;
const MARQUEE = "#0284c7";

/**
 * 選択枠。罫線を足すとセルの大きさが変わるので、内側の影で辺だけ描く。
 * 隣が選ばれていない辺にだけ線が入るので、飛び飛びの選択でもまとまりごとに囲める。
 */
function marqueeShadow(edges: { top: boolean; bottom: boolean; left: boolean; right: boolean } | null) {
  if (!edges) return undefined;
  const parts: string[] = [];
  if (edges.top) parts.push(`inset 0 2px 0 0 ${MARQUEE}`);
  if (edges.bottom) parts.push(`inset 0 -2px 0 0 ${MARQUEE}`);
  if (edges.left) parts.push(`inset 2px 0 0 0 ${MARQUEE}`);
  if (edges.right) parts.push(`inset -2px 0 0 0 ${MARQUEE}`);
  return parts.length ? parts.join(", ") : undefined;
}

/** Excel と同じ修飾キー。Mac は Cmd、Windows は Ctrl。 */
export type ClickMods = { shift: boolean; meta: boolean };
const modsOf = (event: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }): ClickMods => ({
  shift: event.shiftKey,
  meta: event.metaKey || event.ctrlKey,
});

type Interaction = {
  /** 出す日付か（列） */
  dayIncluded: (dayIndex: number) => boolean;
  /** 出す人か（行） */
  rowIncluded: (rowIndex: number) => boolean;
  /** そのセルの選択枠（隣が選ばれていない辺だけ true）。null = 選ばれていない */
  edgesAt: (dayIndex: number, rowIndex: number) => { top: boolean; bottom: boolean; left: boolean; right: boolean } | null;
  onCellPointerDown: (cell: ExportCell, mods: ClickMods) => void;
  onCellPointerEnter: (cell: ExportCell) => void;
  onDayPointerDown: (dayIndex: number, mods: ClickMods) => void;
  onDayPointerEnter: (dayIndex: number) => void;
  onRowPointerDown: (rowIndex: number, mods: ClickMods) => void;
  onRowPointerEnter: (rowIndex: number) => void;
  onSelectAll: () => void;
};

function Cell({ cell }: { cell: ShiftExportCell }) {
  if (cell.kind === "off") {
    return <span className="text-[11px] font-medium text-slate-400">希望休</span>;
  }
  if (cell.kind === "none") return <span className="text-[11px] text-slate-300">—</span>;
  return (
    <div className="flex w-full flex-col items-stretch gap-1">
      {cell.courses.map((course, i) => (
        <div
          key={`${course.label}-${i}`}
          className="flex items-center gap-1 rounded px-1 py-0.5 text-[11px] font-semibold leading-tight text-slate-800"
          // 枠線で色を出す。塗りつぶしだと文字が読みにくく、印刷でも潰れる。
          // ★outline ではなく border を使う。html2canvas は outline を描かないため、
          //   画面では枠が見えているのに画像だけ色が消える（2026-09-19 のプレビューで確認）。
          style={{ border: `2px solid ${course.color}`, background: `${course.color}1a` }}
        >
          <span className="min-w-0 flex-1 break-words">{course.label}</span>
          {course.slotLabel && (
            <span className="shrink-0 rounded bg-white/70 px-1 text-[9px] font-medium text-slate-600">
              {course.slotLabel}
            </span>
          )}
        </div>
      ))}
      {cell.plate ? (
        <div
          className="w-full"
          data-export-plate="true"
          data-export-plate-id={cell.plate.id}
          data-export-plate-color={cell.plate.plate_color ?? "black"}
          data-export-plate-region={cell.plate.number_prefix ?? ""}
          data-export-plate-class={cell.plate.number_class ?? ""}
          data-export-plate-kana={cell.plate.number_hiragana ?? ""}
          data-export-plate-number={cell.plate.number_numeric ?? ""}
        >
          <VehiclePlate vehicle={cell.plate} compact glow={false} className="w-full !max-w-none min-w-0 pointer-events-none" />
        </div>
      ) : cell.externalVehicle ? (
        <span className="text-[10px] text-slate-500">他社車両</span>
      ) : null}
    </div>
  );
}

export function ShiftExportBoard({ data, interaction }: { data: ShiftExportData; interaction?: Interaction }) {
  const width = DRIVER_COL + DAY_COL * data.days.length;
  const hasUnassigned = data.unassigned.some((names) => names.length > 0);
  // 選ぶときだけ見出しと名前の列を固定する（Excel のウィンドウ枠固定）。
  // 右まで引いたときに誰の行か・いつの列かを見失わない。画像には効かせない。
  const stickyHead = interaction ? "sticky top-0 z-20" : "";
  const stickyName = interaction ? "sticky left-0 z-10" : "";
  const stickyCorner = interaction ? "sticky left-0 top-0 z-30" : "";
  const dayOn = (i: number) => !interaction || interaction.dayIncluded(i);
  const rowOn = (i: number) => !interaction || interaction.rowIncluded(i);
  // 範囲の外はグレーにして残す。消さないので、どこを外したかが見えて戻しやすい
  const dim = "opacity-30 grayscale";

  return (
    <div style={{ width }} className="bg-white font-sans text-slate-900">
      <div className="relative z-40 bg-white px-3 pb-2 pt-3">
        <p className="text-base font-bold">{data.title}</p>
        <p className="pt-0.5 text-[11px] text-slate-500">{data.subtitle}</p>
      </div>
      <table className="w-full border-collapse select-none" style={{ width }}>
        <thead>
          <tr>
            <th
              className={`relative border border-slate-300 bg-slate-100 p-0 text-center text-[11px] font-semibold text-slate-600 ${stickyCorner}`}
              style={{ width: DRIVER_COL }}
            >
              <span className="block px-1.5 py-1.5">ドライバー</span>
              {interaction && (
                <button
                  type="button"
                  aria-label="全部を選ぶ"
                  onClick={interaction.onSelectAll}
                  className="absolute inset-0 w-full cursor-pointer"
                />
              )}
            </th>
            {data.days.map((day, dayIndex) => {
              const on = dayOn(dayIndex);
              const head = (
                <span className={on ? "" : "line-through"}>{day.label}</span>
              );
              return (
                <th
                  key={day.iso}
                  className={`relative border border-slate-300 p-0 text-center text-[11px] font-semibold ${stickyHead} ${on ? "" : dim}`}
                  style={{ width: DAY_COL, background: day.headBg, color: day.headColor }}
                >
                  <span className="block px-1 py-1.5">{head}</span>
                  {interaction && (
                    <button
                      type="button"
                      aria-pressed={on}
                      aria-label={`${day.label}の列を選ぶ`}
                      data-export-day={dayIndex}
                      onPointerDown={(event) => interaction.onDayPointerDown(dayIndex, modsOf(event))}
                      onPointerEnter={() => interaction.onDayPointerEnter(dayIndex)}
                      className="absolute inset-0 w-full cursor-pointer"
                    />
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row, rowIndex) => {
            const rowActive = rowOn(rowIndex);
            const name = <span className={`break-words ${rowActive ? "" : "line-through"}`}>{row.name}</span>;
            return (
              <tr key={row.driverId} data-export-row data-export-group={row.driverId}>
                <th
                  scope="row"
                  // 名前は「セルのどこを押しても」行が選べるようにする（2026-09-19 指摘）。
                  // 余白は th ではなくボタン側に持たせ、押せない隙間を作らない。
                  className={`relative border border-slate-300 bg-slate-50 p-0 align-middle text-xs font-bold text-slate-800 ${stickyName} ${rowActive ? "" : dim}`}
                  style={{ width: DRIVER_COL }}
                >
                  <span className="block px-1.5 py-1.5 text-center">{name}</span>
                  {interaction && (
                    // セルのどこを押しても行が選べるよう、全面に重ねる。
                    // flex/ボタン直置きでは行の高さまで伸びず、上下の余白が押せない。
                    <button
                      type="button"
                      aria-pressed={rowActive}
                      aria-label={`${row.name}の行を選ぶ`}
                      data-export-rowhead={rowIndex}
                      onPointerDown={(event) => interaction.onRowPointerDown(rowIndex, modsOf(event))}
                      onPointerEnter={() => interaction.onRowPointerEnter(rowIndex)}
                      className="absolute inset-0 w-full cursor-pointer"
                    />
                  )}
                </th>
                {row.cells.map((cell, dayIndex) => {
                  const on = rowActive && dayOn(dayIndex);
                  return (
                    <td
                      key={data.days[dayIndex]?.iso ?? dayIndex}
                      data-export-cell={interaction ? `${dayIndex}:${rowIndex}` : undefined}
                      className={`border border-slate-300 px-1.5 py-1.5 align-top ${on ? "" : dim} ${interaction ? "cursor-cell" : ""}`}
                      style={{
                        width: DAY_COL,
                        background: data.days[dayIndex]?.cellBg,
                        boxShadow: interaction ? marqueeShadow(interaction.edgesAt(dayIndex, rowIndex)) : undefined,
                      }}
                      onPointerDown={
                        interaction
                          ? (event) => interaction.onCellPointerDown({ dayIndex, rowIndex }, modsOf(event))
                          : undefined
                      }
                      onPointerEnter={
                        interaction ? () => interaction.onCellPointerEnter({ dayIndex, rowIndex }) : undefined
                      }
                    >
                      <Cell cell={cell} />
                    </td>
                  );
                })}
              </tr>
            );
          })}
          {hasUnassigned && (
            <tr>
              <th
                scope="row"
                className={`border border-slate-300 bg-slate-100 px-1.5 py-1.5 text-center align-top text-[11px] font-semibold text-slate-600 ${stickyName}`}
                style={{ width: DRIVER_COL }}
              >
                未割当
              </th>
              {data.unassigned.map((names, dayIndex) => (
                <td
                  key={data.days[dayIndex]?.iso ?? dayIndex}
                  className={`border border-slate-300 px-1.5 py-1.5 align-top text-[10px] leading-snug text-slate-500 ${dayOn(dayIndex) ? "" : dim}`}
                  style={{ width: DAY_COL }}
                >
                  {names || "—"}
                </td>
              ))}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
