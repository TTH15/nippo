import type { LoanSeed } from "./navigation";
import { validPosition, type ParkingPosition } from "./parking-geocoding";

export type LeaseMode = "MONTHLY" | "DAILY" | "NONE";
export type Label = { id: string; name: string };
export type ParkingPlace = { id: string; name: string; detail: string; address?: string; position?: ParkingPosition };
export type VehicleLinkChange = { date: string; vehicleId: string };
export type Driver = { id: string; name: string; no: number; labels: string[]; mode: LeaseMode; amount: number; vehicleId: string; vehicleChanges?: VehicleLinkChange[] };
export type Vehicle = { id: string; plate: string; model: string; unavailable?: boolean };
export type Course = { id: string; name: string; short: string; rate: number; color: string };
export type Shift = { driverId: string; date: string; status: "work" | "off" | "empty"; courseId: string; courseIds?: string[]; vehicleId: string };
export type Loan = { id: string; date: string; vehicleId: string; borrowerId: string; pickupPlaceId: string; pickupTime?: string; returnPlaceId: string; returnTime: string; fuel: string; fuelRecipientId?: string; note: string; checked: boolean; status: "planned" | "returned" | "cancelled"; ownerId?: string; monthlyAmount?: number; dailyRate?: number; borrowerMode?: LeaseMode; borrowerMonthlyAmount?: number };
export type Demo = { labels: Label[]; parkingPlaces: ParkingPlace[]; drivers: Driver[]; vehicles: Vehicle[]; courses: Course[]; shifts: Shift[]; loans: Loan[] };
export const MODE_NAMES: Record<LeaseMode, string> = { MONTHLY: "月額リース", DAILY: "日額リース", NONE: "リースなし" };
export const BEFORE_PICKUP_FUEL = "貸出前に満タンにして引き渡してください。";
export const RETURN_FUEL = "使用分を給油し、満タンで返却してください。";
export const DATES = Array.from({ length: 31 }, (_, index) => {
  const date = new Date("2026-08-31T12:00:00Z"); date.setUTCDate(date.getUTCDate() + index); return date.toISOString().slice(0, 10);
});
export const money = (amount: number) => `¥${amount.toLocaleString("ja-JP")}`;
export function initialDemo(): Demo {
  const labels = [{ id: "amazon", name: "Amazon" }, { id: "toyonaka", name: "豊中" }, { id: "yamato", name: "ヤマト" }, { id: "suita", name: "吹田" }];
  // 駐車場所は集合場所とは分けた、会社内で再利用する架空の登録先。
  const parkingPlaces = [{ id: "parking-toyonaka", name: "豊中車庫", detail: "" }, { id: "parking-suita", name: "吹田車庫", detail: "" }, { id: "parking-shinosaka", name: "新大阪車庫", detail: "" }];
  const drivers: Driver[] = [
    { id: "sato", no: 1, name: "佐藤 翔太", labels: ["amazon", "toyonaka"], mode: "MONTHLY", amount: 35000, vehicleId: "v1" },
    { id: "tanaka", no: 2, name: "田中 美咲", labels: ["amazon"], mode: "MONTHLY", amount: 38000, vehicleId: "v2" },
    { id: "suzuki", no: 3, name: "鈴木 大輔", labels: ["yamato", "suita"], mode: "MONTHLY", amount: 35000, vehicleId: "v3" },
    { id: "takahashi", no: 4, name: "高橋 健太", labels: ["amazon", "toyonaka"], mode: "DAILY", amount: 0, vehicleId: "" },
    { id: "ito", no: 5, name: "伊藤 彩", labels: ["amazon", "suita"], mode: "DAILY", amount: 0, vehicleId: "" },
    { id: "watanabe", no: 6, name: "渡辺 直樹", labels: ["toyonaka", "yamato"], mode: "DAILY", amount: 0, vehicleId: "" },
    { id: "kobayashi", no: 7, name: "小林 悠斗", labels: [], mode: "DAILY", amount: 0, vehicleId: "" },
    { id: "nakamura", no: 8, name: "中村 拓海", labels: ["amazon", "toyonaka"], mode: "NONE", amount: 0, vehicleId: "" },
    { id: "yoshida", no: 9, name: "吉田 莉子", labels: ["yamato"], mode: "NONE", amount: 0, vehicleId: "" },
  ];
  // 公開プレート素材に揃え、画面と日別PNGのどちらもかなをSVGで描く。
  const vehicleNumbers = [1201, 2345, 3456, 4567, 5678, 6789, 7890, 8901];
  const vehicles = Array.from({ length: 8 }, (_, i) => ({ id: `v${i + 1}`, plate: `大阪 480 ${i % 2 ? "れ" : "り"} ${vehicleNumbers[i]}`, model: i % 2 ? "エブリイ" : "ハイゼット", unavailable: i === 7 }));
  const courses: Course[] = [
    { id: "a", name: "Amazon 豊中", short: "豊中", rate: 1800, color: "border-amber-200 bg-amber-50 text-amber-900" },
    { id: "b", name: "Amazon 吹田", short: "吹田", rate: 1800, color: "border-sky-200 bg-sky-50 text-sky-900" },
    { id: "c", name: "ヤマト 北大阪", short: "北大阪", rate: 1500, color: "border-emerald-200 bg-emerald-50 text-emerald-900" },
  ];
  const shifts: Shift[] = drivers.flatMap((d, i) => DATES.map((date, day) => {
    const off = (day + i) % 5 === 2;
    return { driverId: d.id, date, status: off ? "off" : i === 6 && day % 3 === 0 ? "empty" : "work", courseId: i === 2 || i === 5 || i === 8 ? "c" : i === 1 || i === 4 ? "b" : "a", vehicleId: off || d.mode === "NONE" ? "" : d.mode === "MONTHLY" ? d.vehicleId : `v${i + 1}` };
  }));
  return { labels, parkingPlaces, drivers, vehicles, courses, shifts, loans: [{ id: "loan-demo", date: "2026-09-02", vehicleId: "v1", ownerId: "sato", borrowerId: "takahashi", borrowerMode: "DAILY", pickupPlaceId: "parking-toyonaka", pickupTime: "07:00", returnPlaceId: "parking-toyonaka", returnTime: "20:00", fuel: BEFORE_PICKUP_FUEL, fuelRecipientId: "sato", note: "鍵は車庫の指定ボックスへ返却", checked: true, status: "planned" }] };
}
export function parkingPlaceText(demo: Demo, id: string) {
  const place = demo.parkingPlaces.find(item => item.id === id);
  const detail = place && parkingPlaceDescription(place);
  return place ? place.name + (detail ? `（${detail}）` : "") : "未設定";
}
export const parkingPlaceDescription = (place: ParkingPlace) => [place.address, place.detail].filter(Boolean).join("／");
export function validateParkingPlace(demo: Demo, place: ParkingPlace): string | null {
  const name = place.name.trim();
  if (!name || name.length > 40) return "駐車場所の名前は1〜40文字で入力してください。";
  if (place.detail.trim().length > 200) return "目印は200文字以内で入力してください。";
  if ((place.address?.length ?? 0) > 256) return "住所は256文字以内で入力してください。";
  if (place.position && !validPosition(place.position)) return "駐車場所の位置が正しくありません。地図で指定し直してください。";
  if (place.address?.trim() && !place.position) return "住所の候補を選ぶか、地図にピンを置いて位置を指定してください。";
  if (demo.parkingPlaces.some(item => item.id !== place.id && item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) return "同じ名前の駐車場所がすでにあります。";
  return null;
}
export const parkingPlaceUseCount = (demo: Demo, id: string) => demo.loans.filter(loan => loan.pickupPlaceId === id || loan.returnPlaceId === id).length;
export function removeParkingPlace(demo: Demo, id: string, selectedIds: string[] = []) {
  if (parkingPlaceUseCount(demo, id) || selectedIds.includes(id)) return { demo, error: "配車の入力・利用記録で使っている駐車場所は削除できません。" };
  return { demo: { ...demo, parkingPlaces: demo.parkingPlaces.filter(place => place.id !== id) }, error: "" };
}
export function filterDrivers(demo: Demo, label: string | string[], mode: string, query = "") {
  const labels = Array.isArray(label) ? label : label === "all" ? [] : [label];
  return demo.drivers.filter(d => (!labels.length || labels.some(id => id === "unlabeled" ? d.labels.length === 0 : d.labels.includes(id))) && (mode === "all" || d.mode === mode) && d.name.replace(/\s/g, "").includes(query.replace(/\s/g, ""))).sort((a, b) => a.no - b.no);
}
export const shiftFor = (demo: Demo, driverId: string, date: string) => demo.shifts.find(s => s.driverId === driverId && s.date === date);
export const courseIdsFor = (shift?: Shift) => shift?.status === "work" ? [...new Set(shift.courseIds ?? (shift.courseId ? [shift.courseId] : []))] : [];
export function withCourse(shift: Shift, courseId: string, add: boolean): Shift {
  const current = courseIdsFor(shift);
  const courseIds = add ? [...new Set([...current, courseId])] : current.filter(id => id !== courseId);
  return { ...shift, status: courseIds.length ? "work" : "empty", courseIds, courseId: courseIds[0] ?? "", vehicleId: courseIds.length && shift.status === "work" ? shift.vehicleId : "" };
}
export const shiftDailyRate = (demo: Demo, shift?: Shift) => Math.max(0, ...demo.courses.filter(c => courseIdsFor(shift).includes(c.id)).map(c => c.rate));
// 紐付けは普段使う車両の目安。実際の配車を上書き・予約するものではない。
export const linkedVehicleId = (driver: Driver, date: string) => [...(driver.vehicleChanges ?? [])].sort((a, b) => b.date.localeCompare(a.date)).find(change => change.date <= date)?.vehicleId ?? driver.vehicleId;
export const linkedDriversFor = (demo: Demo, vehicleId: string, date: string) => demo.drivers.filter(d => d.mode === "MONTHLY" && linkedVehicleId(d, date) === vehicleId);
export const ownerFor = (demo: Demo, vehicleId: string, date = DATES[0]) => linkedDriversFor(demo, vehicleId, date)[0];
export const loanOwner = (demo: Demo, loan: Loan) => loan.ownerId !== undefined ? demo.drivers.find(d => d.id === loan.ownerId) : ownerFor(demo, loan.vehicleId, loan.date);
export const loanFuelRecipientId = (demo: Demo, loan: Loan) => loan.fuelRecipientId ?? loanOwner(demo, loan)?.id ?? "";
export const loanMonthlyAmount = (demo: Demo, loan: Loan) => loan.monthlyAmount ?? loanOwner(demo, loan)?.amount ?? 0;
export const loanBorrowerMode = (demo: Demo, loan: Loan) => loan.borrowerMode ?? demo.drivers.find(d => d.id === loan.borrowerId)?.mode;
export const loanPickupTime = (loan: Loan) => loan.pickupTime ?? "07:00";
export const activeLoan = (demo: Demo, driverId: string, date: string) => demo.loans.find(l => l.borrowerId === driverId && l.date === date && l.status !== "cancelled");
export function vehicleFor(demo: Demo, driverId: string, date: string) {
  if (shiftFor(demo, driverId, date)?.status !== "work" || demo.drivers.find(d => d.id === driverId)?.mode === "NONE") return undefined;
  const loan = activeLoan(demo, driverId, date);
  return demo.vehicles.find(v => v.id === (loan?.vehicleId || shiftFor(demo, driverId, date)?.vehicleId));
}
export function validateLoan(demo: Demo, loan: Loan): string | null {
  const owner = loanOwner(demo, loan);
  if (!owner || owner.id === loan.borrowerId) return "利用者とは別の貸し出す人を選んでください。";
  if (!DATES.includes(loan.date)) return "サンプル期間内の日付を選んでください。";
  const vehicle = demo.vehicles.find(v => v.id === loan.vehicleId);
  if (!vehicle || vehicle.unavailable) return "この車両は使用できません。";
  if (!["DAILY", "MONTHLY"].includes(demo.drivers.find(d => d.id === loan.borrowerId)?.mode ?? "")) return "利用者はリース契約のあるドライバーを選んでください。";
  if (shiftFor(demo, loan.borrowerId, loan.date)?.status !== "work") return "借り手に稼働予定がある日を選んでください。";
  if (demo.loans.some(l => l.id !== loan.id && l.status !== "cancelled" && l.date === loan.date && (l.vehicleId === loan.vehicleId || l.borrowerId === loan.borrowerId))) return "同じ車両または借り手の一時貸出が、この日に登録されています。";
  if (demo.shifts.some(s => s.date === loan.date && s.status === "work" && s.driverId !== loan.borrowerId && vehicleFor(demo, s.driverId, s.date)?.id === loan.vehicleId)) return "この車両は同日に別のドライバーへ配車されています。";
  if (![loan.pickupPlaceId, loan.returnPlaceId].every(id => demo.parkingPlaces.some(place => place.id === id))) return "受取場所・返却場所を登録済みの駐車場所から選んでください。";
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(loanPickupTime(loan))) return "受取時刻を入力してください。";
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(loan.returnTime)) return "返却時刻を入力してください。";
  if (loan.returnTime <= loanPickupTime(loan)) return "返却時刻は受取時刻より後にしてください。このプレビューは同日中の利用です。";
  if (loan.fuel.trim() && !demo.drivers.some(driver => driver.id === loanFuelRecipientId(demo, loan))) return "給油を依頼する相手を選んでください。";
  if (!loan.checked) return "受け渡しと次回利用に無理がないことを確認してください。";
  return null;
}
export function loanDailyRate(demo: Demo, loan: Loan) {
  if (loanBorrowerMode(demo, loan) !== "DAILY") return 0;
  if (loan.status !== "planned" && loan.dailyRate !== undefined) return loan.dailyRate;
  return shiftDailyRate(demo, shiftFor(demo, loan.borrowerId, loan.date));
}
export function loanNotifications(demo: Demo, loan: Loan) {
  if (loan.status === "cancelled") return [];
  const borrower = demo.drivers.find(d => d.id === loan.borrowerId);
  const vehicle = demo.vehicles.find(v => v.id === loan.vehicleId);
  // 貸出前の満タン給油は月額契約者へ。利用者の返却時給油は別の標準案内にする。
  const fuelRecipientId = loanFuelRecipientId(demo, loan);
  const fuel = loan.fuel.trim();
  const owner = loanOwner(demo, loan);
  const notifications = [{ recipientId: loan.borrowerId, text: `${borrower?.name ?? "借り手"}さん\n${loan.date} の車両は ${vehicle?.plate ?? "未選択"} です。\n受取：${parkingPlaceText(demo, loan.pickupPlaceId)}（${loanPickupTime(loan) || "未入力"}）\n返却：${loan.returnTime || "未入力"}までに ${parkingPlaceText(demo, loan.returnPlaceId)}\n返却時の給油：${RETURN_FUEL}${loan.note ? `\n連絡：${loan.note}` : ""}` }];
  // 給油の有無にかかわらず、貸出側へ同じ受取場所・時刻から駐車案内を作る。
  if (owner && owner.id !== loan.borrowerId) notifications.push({ recipientId: owner.id, text: `${owner.name}さん\n${loan.date} の車両 ${vehicle?.plate ?? "未選択"} を${borrower?.name ?? "利用者"}さんへ貸し出します。\n引き渡し：${loanPickupTime(loan) || "未入力"}までに ${parkingPlaceText(demo, loan.pickupPlaceId)} に駐車してください。\n返却予定：${loan.returnTime || "未入力"}までに ${parkingPlaceText(demo, loan.returnPlaceId)}` });
  if (fuel) {
    const existing = notifications.find(notification => notification.recipientId === fuelRecipientId);
    if (existing) existing.text += `\n貸出前の給油：${fuel}`;
    else {
    const recipient = demo.drivers.find(driver => driver.id === fuelRecipientId);
    notifications.push({ recipientId: fuelRecipientId, text: `${recipient ? `${recipient.name}さん` : "依頼先未設定"}\n${loan.date} の車両 ${vehicle?.plate ?? "未選択"} を貸し出す前に、給油をお願いします。\n利用者：${borrower?.name ?? "未選択"}さん\n引き渡し予定：${loanPickupTime(loan) || "未入力"} ${parkingPlaceText(demo, loan.pickupPlaceId)}\n貸出前の給油：${fuel}` });
    }
  }
  return notifications;
}
export function notificationText(demo: Demo, loan: Loan) {
  return loanNotifications(demo, loan).map(notification => notification.text).join("\n\n");
}
export function validateShift(demo: Demo, shift: Shift): string | null {
  if (!DATES.includes(shift.date)) return "サンプル期間内の日付を選んでください。";
  const linked = activeLoan(demo, shift.driverId, shift.date);
  if (linked && shift.status !== "work") return "一時貸出と予定が重なります。先に一時貸出を取り消してください。";
  if (shift.status !== "work") return null;
  const courseIds = courseIdsFor(shift);
  if (!courseIds.length || courseIds.some(id => !demo.courses.some(c => c.id === id))) return "担当コースを選んでください。";
  if (!shift.vehicleId || linked?.borrowerId === shift.driverId) return null;
  const vehicle = demo.vehicles.find(v => v.id === shift.vehicleId);
  if (!vehicle || vehicle.unavailable) return "この車両は使用できません。";
  // 既存の配車は紐付け変更で無効化しない。新しく他者の紐付け車を使う場合だけ受け渡しを確認。
  const owners = linkedDriversFor(demo, shift.vehicleId, shift.date);
  const unchanged = shiftFor(demo, shift.driverId, shift.date)?.status === "work" && shiftFor(demo, shift.driverId, shift.date)?.vehicleId === shift.vehicleId;
  if (!unchanged && owners.length && !owners.some(owner => owner.id === shift.driverId)) return "月額契約車は配車時の確認が必要です。";
  if (demo.shifts.some(s => s.date === shift.date && s.driverId !== shift.driverId && s.status === "work" && vehicleFor(demo, s.driverId, s.date)?.id === shift.vehicleId)) return "この車両は同日に別のドライバーへ配車されています。";
  return null;
}

export function validateDriver(demo: Demo, editing: Driver, linkDate = DATES[0]): string | null {
  const original = demo.drivers.find(d => d.id === editing.id);
  if (!original) return "ドライバーが見つかりません。";
  if (editing.mode === "MONTHLY" && (!Number.isSafeInteger(editing.amount) || editing.amount <= 0)) return "月額料金を入力してください。";
  if (editing.vehicleId && !demo.vehicles.some(v => v.id === editing.vehicleId)) return "登録済みの車両を選んでください。";
  if (!DATES.includes(linkDate)) return "サンプル期間内の紐付け変更日を選んでください。";
  if (original.mode !== "NONE" && editing.mode === "NONE" && demo.loans.some(l => l.status !== "cancelled" && l.borrowerId === editing.id)) return "一時利用の記録があるため、リースなしへの変更は先に利用内容を確認してください。";
  return null;
}

export function updateDriver(demo: Demo, editing: Driver, linkDate: string): Demo {
  const original = demo.drivers.find(driver => driver.id === editing.id)!;
  const vehicleChanges = linkedVehicleId(original, linkDate) === editing.vehicleId ? original.vehicleChanges : [...(original.vehicleChanges ?? []).filter(change => change.date !== linkDate), { date: linkDate, vehicleId: editing.vehicleId }].sort((a, b) => a.date.localeCompare(b.date));
  const next = { ...editing, amount: editing.mode === "MONTHLY" ? editing.amount : 0, vehicleId: original.vehicleId, vehicleChanges };
  // 既存の貸出側と契約区分を固定し、紐付け変更で通知先・過去の利用を入れ替えない。
  const loans = demo.loans.map(loan => ({ ...loan, ownerId: loan.ownerId ?? loanOwner(demo, loan)?.id, monthlyAmount: loanMonthlyAmount(demo, loan), borrowerMode: loanBorrowerMode(demo, loan), borrowerMonthlyAmount: loan.borrowerMonthlyAmount ?? demo.drivers.find(driver => driver.id === loan.borrowerId)?.amount }));
  return { ...demo, drivers: demo.drivers.map(driver => driver.id === next.id ? next : driver), loans };
}

export function createLoanDraft(demo: Demo, seed: LoanSeed = { date: "2026-09-07" }): Loan {
  const owner = demo.drivers.find(d => d.mode === "MONTHLY" && d.id !== seed.borrowerId && linkedVehicleId(d, seed.date) && !demo.vehicles.find(v => v.id === linkedVehicleId(d, seed.date))?.unavailable && !demo.shifts.some(s => s.date === seed.date && s.driverId !== seed.borrowerId && vehicleFor(demo, s.driverId, s.date)?.id === linkedVehicleId(d, seed.date)) && !demo.loans.some(l => l.date === seed.date && l.vehicleId === linkedVehicleId(d, seed.date) && l.status !== "cancelled"));
  const placeId = demo.parkingPlaces[0]?.id ?? "";
  const vehicleId = seed.vehicleId ?? (owner ? linkedVehicleId(owner, seed.date) : "");
  const owners = linkedDriversFor(demo, vehicleId, seed.date).filter(d => d.id !== seed.borrowerId);
  const ownerId = owners.length === 1 ? owners[0].id : "";
  return { id: `loan-${Date.now()}`, date: seed.date, vehicleId, ownerId, borrowerId: seed.borrowerId ?? "", pickupPlaceId: placeId, pickupTime: "07:00", returnPlaceId: placeId, returnTime: "20:00", fuel: "", fuelRecipientId: ownerId, note: "", checked: false, status: "planned" };
}

// 取消や貸出日・借り手の変更で通常配車に戻るとき、既に他者が使用していれば未配車にする。
// 元の配車を勝手に奪わず、呼び出し側で再配車が必要なことを知らせる。
export function updateLoan(demo: Demo, loan: Loan): { demo: Demo; releasedWithoutVehicle: Shift[] } {
  const previous = demo.loans.find(l => l.id === loan.id);
  const owner = loanOwner(demo, loan);
  loan = { ...loan, ownerId: owner?.id, monthlyAmount: loan.monthlyAmount ?? owner?.amount, borrowerMode: loanBorrowerMode(demo, loan), borrowerMonthlyAmount: loan.borrowerMonthlyAmount ?? demo.drivers.find(driver => driver.id === loan.borrowerId)?.amount, dailyRate: loanDailyRate(demo, { ...loan, status: "planned" }) };
  let next = { ...demo, loans: previous ? demo.loans.map(l => l.id === loan.id ? loan : l) : [...demo.loans, loan] };
  const releasedWithoutVehicle: Shift[] = [];
  if (previous && previous.status !== "cancelled" && (loan.status === "cancelled" || previous.date !== loan.date || previous.borrowerId !== loan.borrowerId)) {
    const shift = shiftFor(next, previous.borrowerId, previous.date);
    if (shift?.vehicleId && validateShift(next, shift)) {
      releasedWithoutVehicle.push(shift);
      next = { ...next, shifts: next.shifts.map(s => s === shift ? { ...s, vehicleId: "" } : s) };
    }
  }
  return { demo: next, releasedWithoutVehicle };
}
