import { activeLoan, courseIdsFor, filterDrivers, loanOwner, MODE_NAMES, shiftFor, vehicleFor, type Demo, type LeaseMode, type Vehicle } from "./model";
import { DAY_FILTER_LABELS, filterDayDrivers, hasDayAssignment, type DayFilter } from "./dayFilter";
import { driverDetailsVisible, type ShiftView } from "./navigation";
import { renderPlateImage } from "./plateImage";

export type ImageRow = { id: string; name: string; labels: string[]; group: string; status: string; courses: { name: string; color: string }[]; meetingTime: boolean; vehicle?: Vehicle; vehicleText?: string; loanText?: string };
export type DayImageData = { date: string; filters: string; rows: ImageRow[]; grouped: boolean; working: number; showDriverDetails: boolean; compact: boolean };
export type ImageArtifact = { blob: Blob; url: string; width: number; height: number };
const colors: Record<string, string> = { a: "#fbbf24", b: "#38bdf8", c: "#34d399" };
export const IMAGE_PAGE_SIZE = 10;

export function buildDayImageData(demo: Demo, view: ShiftView, date: string, dayFilter: DayFilter = view.dayFilter): DayImageData {
  let drivers = filterDayDrivers(demo, filterDrivers(demo, view.labelIds, view.mode, view.query), date, dayFilter);
  if (view.grouped) drivers = (["MONTHLY", "DAILY", "NONE"] as LeaseMode[]).flatMap(mode => drivers.filter(driver => driver.mode === mode));
  const showDriverDetails = driverDetailsVisible(view);
  const rows = drivers.map(driver => {
    const shift = shiftFor(demo, driver.id, date);
    const work = hasDayAssignment(demo, driver, date);
    const loan = activeLoan(demo, driver.id, date);
    const lent = demo.loans.find(item => item.date === date && item.status !== "cancelled" && loanOwner(demo, item)?.id === driver.id);
    const vehicle = work && view.showVehicle && driver.mode !== "NONE" ? vehicleFor(demo, driver.id, date) : undefined;
    return {
      id: driver.id, name: driver.name, group: MODE_NAMES[driver.mode],
      labels: showDriverDetails ? driver.labels.map(id => demo.labels.find(label => label.id === id)?.name).filter((name): name is string => Boolean(name)) : [],
      status: work ? "稼働" : shift?.status === "off" ? "希望休" : shift ? "未割当" : "データなし",
      courses: work && view.showShift ? demo.courses.filter(course => courseIdsFor(shift).includes(course.id)).map(course => ({ name: course.short, color: colors[course.id] || "#94a3b8" })) : [],
      meetingTime: Boolean(work && view.showMeetingTime), vehicle,
      vehicleText: work && view.showVehicle && !vehicle ? driver.mode === "NONE" ? "持込車両" : "車両なし" : undefined,
      loanText: view.showVehicle ? [loan ? `一時借用${loan.status === "returned" ? "・返却済み" : ""}` : "", lent ? `車両を貸出${lent.status === "returned" ? "・返却済み" : ""}` : ""].filter(Boolean).join(" / ") : undefined,
    };
  });
  const labels = view.labelIds.map(id => id === "unlabeled" ? "ラベル未設定" : demo.labels.find(label => label.id === id)?.name).filter(Boolean).join("、");
  return { date, rows, grouped: view.grouped, showDriverDetails, compact: !view.showVehicle && !showDriverDetails, working: rows.filter(row => row.status === "稼働").length,
    filters: [labels ? `ラベル：${labels}` : "すべてのラベル", view.mode === "all" ? "すべての契約" : MODE_NAMES[view.mode as LeaseMode], view.query ? `名前：${view.query}` : "", DAY_FILTER_LABELS[dayFilter]].filter(Boolean).join(" / ") };
}

/** スマホの日別配車リストを基に描画。SVG素材の解像度を保ち、CSS maskへの依存を避ける。 */
export async function renderDayImage(data: DayImageData, page: number): Promise<ImageArtifact> {
  const rows = data.rows.slice(page * IMAGE_PAGE_SIZE, (page + 1) * IMAGE_PAGE_SIZE);
  if (!rows.length) throw new Error("画像にするドライバーがいません");
  await document.fonts.ready;
  const plates = new Map(await Promise.all(rows.filter(row => row.vehicle).map(async row => [row.id, await renderPlateImage(row.vehicle!)] as const)));
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("画像を描画できませんでした");
  const font = (size: number, bold = false) => { ctx.font = `${bold ? 600 : 400} ${size}px sans-serif`; ctx.textBaseline = "top"; };
  const lines = (value: string, width: number) => {
    const result: string[] = []; let line = "";
    for (const ch of value) {
      if (line && ctx.measureText(line + ch).width > width) { result.push(line); line = ""; }
      line += ch;
    }
    if (line) result.push(line);
    return result;
  };
  font(10); const filterLines = lines(data.filters, 358);
  const showContract = data.showDriverDetails && !data.grouped;
  const rowPadding = data.compact ? 8 : 12;
  const layout = rows.map(row => {
    font(14, true); const names = lines(row.name, 196);
    font(10); const labels = data.showDriverDetails ? lines(row.labels.join(" / ") || "ラベル未設定", 196) : [];
    font(9); const loanLines = row.loanText ? lines(row.loanText, 112) : [];
    const hasContent = row.courses.length || row.meetingTime || row.vehicle || row.vehicleText;
    const contentHeight = row.courses.length * 28 + (row.meetingTime ? 17 : 0) + (row.vehicle ? 56 : row.vehicleText ? 20 : 0) + loanLines.length * 13 + (hasContent ? 0 : data.compact ? 24 : 32);
    return { row, names, labels, loanLines, height: Math.max(names.length * 20 + labels.length * 15 + (showContract ? 18 : 0), contentHeight, data.compact ? 28 : 40) + rowPadding * 2 };
  });
  const groupCount = data.grouped ? rows.filter((row, index) => index === 0 || row.group !== rows[index - 1].group).length : 0;
  const height = 88 + filterLines.length * 15 + layout.reduce((sum, item) => sum + item.height, 0) + groupCount * 30 + 40;
  // 10人ずつ分割し、さらに総画素数を抑えてスマホのCanvasメモリ消費を制限する。
  const scale = Math.min(3, Math.sqrt(4_000_000 / (390 * height)));
  canvas.width = Math.ceil(390 * scale); canvas.height = Math.ceil(height * scale);
  ctx.scale(scale, scale);
  const text = (value: string, x: number, y: number, size: number, color = "#334155", bold = false, maxWidth?: number) => {
    font(size, bold); ctx.fillStyle = color;
    if (maxWidth === undefined) ctx.fillText(value, x, y);
    else ctx.fillText(value, x, y, maxWidth);
  };
  ctx.fillStyle = "#f8fafc"; ctx.fillRect(0, 0, 390, height);
  const day = new Date(data.date + "T12:00:00");
  text(`${day.getFullYear()}/${day.getMonth() + 1}/${day.getDate()}（${"日月火水木金土"[day.getDay()]}）`, 16, 18, 20, "#0f172a", true);
  text(`日別配車 · ${data.rows.length}人（稼働 ${data.working}人）`, 16, 48, 12);
  filterLines.forEach((line, index) => text(line, 16, 69 + index * 15, 10, "#64748b"));
  let y = 88 + filterLines.length * 15;
  let previousGroup = "";
  for (const { row, names, labels, loanLines, height: rowHeight } of layout) {
    if (data.grouped && previousGroup !== row.group) {
      ctx.fillStyle = "#e2e8f0"; ctx.fillRect(16, y, 358, 30);
      text(row.group, 28, y + 9, 11, "#475569", true); y += 30; previousGroup = row.group;
    }
    ctx.fillStyle = "#ffffff"; ctx.fillRect(16, y, 358, rowHeight);
    ctx.fillStyle = "#e2e8f0"; ctx.fillRect(16, y + rowHeight - 1, 358, 1);
    const leftY = y + (rowHeight - names.length * 20 - labels.length * 15 - (showContract ? 18 : 0)) / 2;
    names.forEach((line, index) => text(line, 28, leftY + index * 20, 14, "#1e293b", true));
    labels.forEach((line, index) => text(line, 28, leftY + names.length * 20 + index * 15, 10, "#64748b"));
    if (showContract) text(row.group, 28, leftY + names.length * 20 + labels.length * 15 + 3, 10, "#64748b");
    let rightY = y + rowPadding;
    for (const course of row.courses) {
      ctx.fillStyle = course.color + "70"; ctx.strokeStyle = course.color + "b8"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect(257, rightY + 1, 98, 22, 5); ctx.fill(); ctx.stroke();
      text(course.name, 262, rightY + 6, 11, "#0f172a", true, 66); text("終日", 332, rightY + 7, 9, "#64748b");
      rightY += 28;
    }
    if (row.meetingTime) { text("集合 07:30", 269, rightY, 10, "#64748b"); rightY += 17; }
    if (row.vehicle) {
      const plate = plates.get(row.id)!;
      // 影用の透明余白を含めても、プレート本体は画面と同じ100×50pxに保つ。
      ctx.drawImage(plate.canvas, 256 - plate.padding, rightY + 2 - plate.padding, plate.width + plate.padding * 2, plate.height + plate.padding * 2);
      rightY += 56;
    }
    else if (row.vehicleText) { text(row.vehicleText, 267, rightY + 3, 11, "#92400e"); rightY += 20; }
    if (!row.courses.length && !row.meetingTime && !row.vehicle && !row.vehicleText) {
      text(row.status, 276, rightY + 10, 12, row.status === "希望休" ? "#92400e" : "#64748b"); rightY += 32;
    }
    loanLines.forEach((line, index) => text(line, 250, rightY + index * 13, 9, "#92400e"));
    y += rowHeight;
  }
  const pages = Math.ceil(data.rows.length / IMAGE_PAGE_SIZE);
  text(`管理プレビュー・架空データ${pages > 1 ? `  ${page + 1} / ${pages}枚` : ""}`, 16, y + 14, 10, "#64748b");
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("PNG画像を生成できませんでした")), "image/png"));
  return { blob, url: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height };
}
