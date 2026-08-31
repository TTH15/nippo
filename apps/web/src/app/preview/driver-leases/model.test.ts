import { describe, expect, it } from "vitest";
import { courseIdsFor, shiftFor, withCourse, activeLoan, createLoanDraft, linkedVehicleId, linkedDriversFor, updateDriver, filterDrivers, initialDemo, loanDailyRate, loanMonthlyAmount, loanNotifications, loanOwner, notificationText, updateLoan, validateDriver, validateLoan, validateShift, vehicleFor, type Loan } from "./model";
import { removeParkingPlace, validateParkingPlace } from "./model";

const newLoan = (): Loan => ({ id: "new", date: "2026-09-07", vehicleId: "v1", borrowerId: "takahashi", pickupPlaceId: "parking-toyonaka", returnPlaceId: "parking-toyonaka", returnTime: "20:00", fuel: "貸出前に満タン給油", note: "", checked: true, status: "planned" });
describe("リースと複数ラベルのモック", () => {
  it("並列ラベルの片方だけを選んでも複数所属の人を含み、重複表示しない", () => {
    const demo = initialDemo();
    const amazon = filterDrivers(demo, "amazon", "all");
    expect(amazon.map(d => d.id)).toEqual(["sato", "tanaka", "takahashi", "ito", "nakamura"]);
    expect(filterDrivers(demo, "toyonaka", "all").map(d => d.id)).toContain("sato");
    expect(filterDrivers(demo, "amazon", "MONTHLY").map(d => d.id)).toEqual(["sato", "tanaka"]);
    expect(new Set(amazon.map(d => d.id)).size).toBe(amazon.length);
  });
  it("ラベル未設定も全員表示に含み、個別に絞り込める", () => {
    const demo = initialDemo();
    expect(filterDrivers(demo, "all", "all")).toHaveLength(9);
    expect(filterDrivers(demo, "unlabeled", "all").map(d => d.id)).toEqual(["kobayashi"]);
    expect(filterDrivers(demo, "yamato", "MONTHLY", "佐藤")).toHaveLength(0);
  });
  it("通知の内容に給油・返却先と期限を含める", () => {
    const text = notificationText(initialDemo(), newLoan());
    expect(text).toContain("高橋 健太さん"); expect(text).toContain("20:00までに 豊中車庫"); expect(text).toContain("使用分を給油");
  });
  it("給油を別の人へ依頼すると配車通知と依頼を宛先ごとに分ける", () => {
    const demo = initialDemo();
    const notifications = loanNotifications(demo, { ...newLoan(), fuelRecipientId: "sato", note: "鍵は指定ボックスへ" });
    expect(notifications.map(notification => notification.recipientId)).toEqual(["takahashi", "sato"]);
    expect(notifications[0].text).toContain("高橋 健太さん");
    expect(notifications[0].text).not.toContain("貸出前の給油");
    expect(notifications[0].text).toContain("返却時の給油：使用分を給油し、満タンで返却してください。");
    expect(notifications[0].text).toContain("鍵は指定ボックスへ");
    expect(notifications[1].text).toContain("佐藤 翔太さん");
    expect(notifications[1].text).toContain("2026-09-07 の車両 大阪 480 り 1201");
    expect(notifications[1].text).toContain("貸出前の給油：貸出前に満タン給油");
    expect(notifications[1].text).not.toContain("返却時の給油");
    expect(notifications[1].text).not.toContain("鍵は指定ボックスへ");
  });
  it("月額契約者を初期依頼先にし、依頼なしでも利用者の返却時給油を案内する", () => {
    const demo = initialDemo();
    expect(loanNotifications(demo, { ...newLoan(), fuelRecipientId: "sato" })).toEqual(loanNotifications(demo, newLoan()));
    expect(loanNotifications(demo, newLoan()).map(notification => notification.recipientId)).toEqual(["takahashi", "sato"]);
    const sameRecipient = loanNotifications(demo, { ...newLoan(), fuelRecipientId: "takahashi" });
    expect(sameRecipient).toHaveLength(2);
    expect(sameRecipient[0].text).toContain("貸出前の給油：貸出前に満タン給油");
    const withoutFuel = loanNotifications(demo, { ...newLoan(), fuel: " ", fuelRecipientId: "sato" });
    expect(withoutFuel).toHaveLength(2);
    expect(withoutFuel[1].text).toContain("07:00までに 豊中車庫 に駐車してください。");
    expect(withoutFuel[1].text).not.toContain("貸出前の給油");
    expect(withoutFuel[0].text).not.toContain("貸出前の給油");
    expect(withoutFuel[0].text).toContain("返却時の給油：使用分を給油し、満タンで返却してください。");
    expect(loanNotifications(demo, { ...newLoan(), fuelRecipientId: "sato", status: "cancelled" })).toEqual([]);
  });
  it("給油の依頼先は登録済みの人に限り、未選択や未知のIDでは保存できない", () => {
    const demo = initialDemo();
    for (const fuelRecipientId of ["sato", "takahashi", "ito"]) expect(validateLoan(demo, { ...newLoan(), fuelRecipientId })).toBeNull();
    for (const fuelRecipientId of ["", "unknown"]) expect(validateLoan(demo, { ...newLoan(), fuelRecipientId })).toContain("給油を依頼する相手");
  });
  it("配車した車両の月額契約者を依頼先の初期値にする", () => {
    const demo = initialDemo();
    expect(createLoanDraft(demo, { date: "2026-09-07", borrowerId: "takahashi", vehicleId: "v1" }).fuelRecipientId).toBe("sato");
    expect(createLoanDraft(demo, { date: "2026-09-07", borrowerId: "takahashi", vehicleId: "v2" }).fuelRecipientId).toBe("tanaka");
    expect(demo.loans[0]).toMatchObject({ fuelRecipientId: "sato", fuel: "貸出前に満タンにして引き渡してください。" });
  });
  it("月額契約は維持して一時利用者の車両だけを切り替え、取消時は元に戻す", () => {
    const demo = initialDemo();
    expect(vehicleFor(demo, "takahashi", "2026-09-02")?.id).toBe("v1");
    expect(demo.drivers.find(d => d.id === "sato")?.amount).toBe(35000);
    expect(loanDailyRate(demo, demo.loans[0])).toBe(1800);
    demo.loans[0].status = "cancelled";
    expect(activeLoan(demo, "takahashi", "2026-09-02")).toBeUndefined();
    expect(vehicleFor(demo, "takahashi", "2026-09-02")?.id).toBe("v4");
    expect(demo.drivers.find(d => d.id === "sato")?.amount).toBe(35000);
  });
  it("休み・稼働予定・受け渡し確認が揃った貸出を受け付ける", () => expect(validateLoan(initialDemo(), newLoan())).toBeNull());
  it("未割当でも実配車がなければ受け渡し確認の上で貸出できる", () => {
    const demo = initialDemo(); demo.shifts.find(s => s.driverId === "sato" && s.date === "2026-09-07")!.status = "empty";
    expect(validateLoan(demo, newLoan())).toBeNull();
    expect(validateLoan(demo, { ...newLoan(), checked: false })).toContain("受け渡し");
  });
  it("車両または借り手の二重貸出を防ぐ", () => {
    const demo = initialDemo(); demo.loans.push(newLoan());
    expect(validateLoan(demo, { ...newLoan(), id: "other", borrowerId: "ito" })).toContain("登録されています");
  });
  it("確認未完了・返却先なし・不正時刻では保存しない", () => {
    for (const patch of [{ checked: false }, { returnPlaceId: "" }, { returnTime: "29:00" }]) expect(validateLoan(initialDemo(), { ...newLoan(), ...patch })).not.toBeNull();
  });
  it("通常の配車から他人の月額車を使えず、一時貸出と競合するシフト変更も拒否", () => {
    const demo = initialDemo();
    expect(validateShift(demo, { driverId: "ito", date: "2026-09-01", status: "work", courseId: "b", vehicleId: "v1" })).toContain("配車時の確認が必要");
    expect(validateShift(demo, { driverId: "sato", date: "2026-09-02", status: "work", courseId: "a", vehicleId: "v1" })).toContain("別のドライバーへ配車");
  });
  it("共用車の二重配車を防ぐ", () => {
    const demo = initialDemo();
    expect(validateShift(demo, { driverId: "ito", date: "2026-09-01", status: "work", courseId: "b", vehicleId: "v4" })).toContain("別のドライバーへ配車");
  });
  it("シフトの日付・借り手を引き継いで、その日に休みの月額車を候補にする", () => {
    const loan = createLoanDraft(initialDemo(), { date: "2026-09-07", borrowerId: "takahashi" });
    expect(loan).toMatchObject({ date: "2026-09-07", vehicleId: "v1", borrowerId: "takahashi", checked: false });
    expect(validateLoan(initialDemo(), { ...loan, checked: true })).toBeNull();
  });
  it("紐付けは他者と重なっても許可し、実際の配車は変更しない", () => {
    const demo = initialDemo();
    const ito = demo.drivers.find(d => d.id === "ito")!;
    expect(validateDriver(demo, { ...ito, mode: "MONTHLY", amount: 35000, vehicleId: "v5" })).toBeNull();
    expect(validateDriver(demo, { ...ito, mode: "MONTHLY", amount: 35000, vehicleId: "v4" })).toBeNull();
    expect(validateDriver(demo, { ...ito, mode: "MONTHLY", amount: 35000, vehicleId: "v1" })).toBeNull();
    const next = updateDriver(demo, { ...ito, mode: "MONTHLY", amount: 35000, vehicleId: "v4" }, "2026-09-16");
    expect(next.shifts).toBe(demo.shifts);
    expect(vehicleFor(next, "takahashi", "2026-09-16")?.id).toBe(vehicleFor(demo, "takahashi", "2026-09-16")?.id);
  });
  it("貸出の記録があっても紐付けや月額・日額を変更でき、既存の利用は維持する", () => {
    const demo = initialDemo();
    const sato = demo.drivers.find(d => d.id === "sato")!;
    const borrower = demo.drivers.find(d => d.id === "takahashi")!;
    expect(validateDriver(demo, { ...sato, mode: "DAILY", vehicleId: "" })).toBeNull();
    expect(validateDriver(demo, { ...borrower, mode: "MONTHLY", amount: 35000, vehicleId: "v4" })).toBeNull();
    const next = updateDriver(demo, { ...borrower, mode: "MONTHLY", amount: 35000 }, "2026-09-07");
    expect(vehicleFor(next, borrower.id, "2026-09-02")?.id).toBe("v1");
    expect(loanDailyRate(next, next.loans[0])).toBe(1800);
    expect(validateDriver(demo, { ...sato, amount: 39000, labels: ["amazon"] })).toBeNull();
  });
  it("貸出の取消後は契約切替でき、無関係な配車は変わらない", () => {
    const original = initialDemo();
    const { demo, releasedWithoutVehicle } = updateLoan(original, { ...original.loans[0], status: "cancelled" });
    expect(releasedWithoutVehicle).toEqual([]);
    expect(demo.shifts).toBe(original.shifts);
    expect(validateDriver(demo, { ...demo.drivers.find(d => d.id === "sato")!, mode: "DAILY", vehicleId: "" })).toBeNull();
    expect(original.loans[0].status).toBe("planned");
  });
  it("取消後の元の車両が使用中なら、利用中の人を残して元の借り手を未配車にする", () => {
    const original = initialDemo();
    const other = original.shifts.find(s => s.driverId === "ito" && s.date === "2026-09-02")!;
    other.vehicleId = "v4";
    expect(validateShift(original, other)).toBeNull();
    const result = updateLoan(original, { ...original.loans[0], status: "cancelled" });
    expect(result.releasedWithoutVehicle.map(s => s.driverId)).toEqual(["takahashi"]);
    expect(vehicleFor(result.demo, "takahashi", "2026-09-02")).toBeUndefined();
    expect(vehicleFor(result.demo, "ito", "2026-09-02")?.id).toBe("v4");
    expect(original.shifts.find(s => s.driverId === "takahashi" && s.date === "2026-09-02")?.vehicleId).toBe("v4");
  });
  it("貸出日の変更でも元の日の車両を二重配車しない", () => {
    const demo = initialDemo();
    demo.shifts.find(s => s.driverId === "ito" && s.date === "2026-09-02")!.vehicleId = "v4";
    const loan = { ...demo.loans[0], date: "2026-09-07" };
    expect(validateLoan(demo, loan)).toBeNull();
    const result = updateLoan(demo, loan);
    expect(vehicleFor(result.demo, "takahashi", "2026-09-02")).toBeUndefined();
    expect(vehicleFor(result.demo, "takahashi", "2026-09-07")?.id).toBe("v1");
    expect(result.releasedWithoutVehicle).toHaveLength(1);
  });
  it("休みや未割当の隠れた車両を配車済みとして扱わない", () => {
    const demo = initialDemo();
    const shift = demo.shifts.find(s => s.driverId === "kobayashi" && s.status === "empty")!;
    expect(shift.vehicleId).toBeTruthy();
    expect(vehicleFor(demo, shift.driverId, shift.date)).toBeUndefined();
  });
  it("返却済みでもその日の利用記録を保ち、休みへの変更を防ぐ", () => {
    const demo = initialDemo();
    const result = updateLoan(demo, { ...demo.loans[0], status: "returned" });
    expect(vehicleFor(result.demo, "takahashi", "2026-09-02")?.id).toBe("v1");
    expect(validateShift(result.demo, { driverId: "takahashi", date: "2026-09-02", status: "off", courseId: "a", vehicleId: "" })).toContain("一時貸出と予定");
  });
  it("取消後に契約やコースを変えても、取消時の貸出元と料金表示を保つ", () => {
    const original = initialDemo();
    const { demo } = updateLoan(original, { ...original.loans[0], status: "cancelled" });
    demo.drivers = demo.drivers.map(d => d.id === "sato" ? { ...d, mode: "DAILY", amount: 0, vehicleId: "" } : d);
    demo.shifts = demo.shifts.map(s => s.driverId === "takahashi" && s.date === "2026-09-02" ? { ...s, courseId: "c" } : s);
    expect(loanOwner(demo, demo.loans[0])?.id).toBe("sato");
    expect(loanMonthlyAmount(demo, demo.loans[0])).toBe(35000);
    expect(loanDailyRate(demo, demo.loans[0])).toBe(1800);
  });
});

describe("柔軟な紐付け・代車と貸出側への通知", () => {
  it("給油なしでも貸出側へ駐車場所・期限を通知し、給油担当が別なら3人へ分ける", () => {
    const demo = initialDemo();
    const loan = { ...newLoan(), pickupTime: "06:30", pickupPlaceId: "parking-suita", fuel: "", ownerId: "sato" };
    const messages = loanNotifications(demo, loan);
    expect(messages.map(message => message.recipientId)).toEqual(["takahashi", "sato"]);
    expect(messages[0].text).toContain("受取：吹田車庫（06:30）");
    expect(messages[1].text).toContain("06:30までに 吹田車庫 に駐車してください。");
    expect(messages[1].text).not.toContain("貸出前の給油");
    const separate = loanNotifications(demo, { ...loan, fuel: "満タンにする", fuelRecipientId: "ito", note: "利用者だけの連絡" });
    expect(separate.map(message => message.recipientId)).toEqual(["takahashi", "sato", "ito"]);
    expect(separate[2].text).toContain("06:30 吹田車庫");
    expect(separate[2].text).not.toContain("利用者だけの連絡");
  });
  it("月額同士で借用でき、借り手の日額料金や普段の紐付けを追加しない", () => {
    const demo = initialDemo();
    const loan = createLoanDraft(demo, { date: "2026-09-07", borrowerId: "tanaka", vehicleId: "v1" });
    expect(validateLoan(demo, { ...loan, checked: true })).toBeNull();
    const next = updateLoan(demo, { ...loan, checked: true }).demo;
    expect(vehicleFor(next, "tanaka", loan.date)?.id).toBe("v1");
    expect(linkedVehicleId(next.drivers[1], loan.date)).toBe("v2");
    expect(next.drivers[1].amount).toBe(38000);
    expect(loanDailyRate(next, next.loans.at(-1)!)).toBe(0);
    expect(notificationText(next, next.loans.at(-1)!)).not.toContain("日額リースの利用者");
  });
  it("貸出側が別車両で稼働しても貸出可能だが、同じ車の実配車は拒否する", () => {
    const demo = initialDemo();
    const lenderShift = shiftFor(demo, "sato", "2026-09-07")!;
    Object.assign(lenderShift, { status: "work", vehicleId: "v6" });
    expect(validateLoan(demo, newLoan())).toBeNull();
    lenderShift.vehicleId = "v1";
    expect(validateLoan(demo, newLoan())).toContain("別のドライバーへ配車");
  });
  it("整備中の普段の車両から代車へ替えても紐付けと前後日の配車を保つ", () => {
    const demo = initialDemo();
    demo.vehicles[0].unavailable = true;
    const current = shiftFor(demo, "sato", "2026-09-08")!;
    expect(validateShift(demo, { ...current, vehicleId: "v5" })).toBeNull();
    expect(validateShift(demo, { ...current, vehicleId: "v8" })).toContain("使用できません");
    expect(linkedVehicleId(demo.drivers[0], current.date)).toBe("v1");
    expect(shiftFor(demo, "sato", "2026-09-09")?.vehicleId).toBe("v1");
    expect(validateDriver(demo, demo.drivers[0])).toBeNull();
  });
  it("月途中の変更は前の紐付け・配車・貸出通知先を変えず、次の変更予定も残す", () => {
    const demo = initialDemo();
    const future = updateDriver(demo, { ...demo.drivers[0], vehicleId: "v6" }, "2026-09-16");
    const next = updateDriver(future, { ...future.drivers[0], vehicleId: "v5" }, "2026-09-10");
    expect(linkedVehicleId(next.drivers[0], "2026-09-09")).toBe("v1");
    expect(linkedVehicleId(next.drivers[0], "2026-09-10")).toBe("v5");
    expect(linkedVehicleId(next.drivers[0], "2026-09-16")).toBe("v6");
    expect(next.shifts).toBe(demo.shifts);
    expect(loanOwner(next, next.loans[0])?.id).toBe("sato");
    expect(loanNotifications(next, next.loans[0])[1].recipientId).toBe("sato");
    const unlinked = updateDriver(next, { ...next.drivers[0], vehicleId: "" }, "2026-09-20");
    expect(linkedVehicleId(unlinked.drivers[0], "2026-09-20")).toBe("");
    expect(unlinked.drivers[0].amount).toBe(35000);
  });
  it("複数人の紐付けが重なっても許可し、実際の貸出側は明示選択する", () => {
    const demo = initialDemo();
    const next = updateDriver(demo, { ...demo.drivers[1], vehicleId: "v1" }, "2026-09-07");
    expect(linkedDriversFor(next, "v1", "2026-09-07").map(d => d.id)).toEqual(["sato", "tanaka"]);
    const loan = createLoanDraft(next, { date: "2026-09-07", vehicleId: "v1", borrowerId: "takahashi" });
    expect(loan.ownerId).toBe("");
    expect(validateLoan(next, { ...loan, checked: true })).toContain("貸し出す人");
    expect(validateLoan(next, { ...loan, ownerId: "sato", checked: true })).toBeNull();
    expect(validateLoan(next, { ...loan, ownerId: "takahashi", checked: true })).toContain("貸し出す人");
  });
  it("受取・返却の時刻や貸出側が不正なら保存を拒否する", () => {
    const demo = initialDemo();
    for (const patch of [{ pickupTime: "" }, { pickupTime: "24:00" }, { pickupTime: "20:00" }, { ownerId: "missing" }]) expect(validateLoan(demo, { ...newLoan(), ...patch })).not.toBeNull();
  });
});

describe("登録済み駐車場所と配車の参照", () => {
  it("名称・目印を編集しても同じ場所IDを参照し、通知へ反映する", () => {
    const demo = initialDemo();
    const loan = newLoan();
    demo.parkingPlaces[0] = { ...demo.parkingPlaces[0], name: "豊中第1車庫", detail: "北側入口・区画A" };
    expect(validateLoan(demo, loan)).toBeNull();
    expect(loan.pickupPlaceId).toBe("parking-toyonaka");
    expect(notificationText(demo, loan)).toContain("受取：豊中第1車庫（北側入口・区画A）");
    expect(notificationText(demo, loan)).toContain("返却：20:00までに 豊中第1車庫（北側入口・区画A）");
  });
  it("未登録・存在しない場所では確定できず、候補なしの初期入力は空にする", () => {
    const demo = initialDemo();
    for (const patch of [{ pickupPlaceId: "" }, { returnPlaceId: "unknown" }]) expect(validateLoan(demo, { ...newLoan(), ...patch })).toContain("登録済みの駐車場所");
    demo.parkingPlaces = [];
    const draft = createLoanDraft(demo, { date: "2026-09-07", borrowerId: "takahashi" });
    expect(draft).toMatchObject({ pickupPlaceId: "", returnPlaceId: "" });
    expect(validateLoan(demo, { ...draft, checked: true })).toContain("登録済みの駐車場所");
  });
  it("入力中・利用記録の場所を削除できず、未使用の場所だけ削除できる", () => {
    const demo = initialDemo();
    for (const status of ["planned", "returned", "cancelled"] as const) {
      demo.loans[0].status = status;
      expect(removeParkingPlace(demo, "parking-toyonaka").demo).toBe(demo);
      expect(removeParkingPlace(demo, "parking-toyonaka").error).toContain("削除できません");
    }
    expect(removeParkingPlace(demo, "parking-suita", ["parking-suita"]).error).toContain("削除できません");
    const result = removeParkingPlace(demo, "parking-suita");
    expect(result.error).toBe("");
    expect(result.demo.parkingPlaces.map(place => place.id)).not.toContain("parking-suita");
    expect(result.demo.loans).toBe(demo.loans);
  });
  it("空白・重複名は拒否し、使用中でも同じIDの名前や目印は編集できる", () => {
    const demo = initialDemo();
    expect(validateParkingPlace(demo, { id: "new", name: " ", detail: "" })).toContain("1〜40文字");
    expect(validateParkingPlace(demo, { id: "new", name: " 豊中車庫 ", detail: "" })).toContain("同じ名前");
    expect(validateParkingPlace(demo, { ...demo.parkingPlaces[0], detail: "北側入口" })).toBeNull();
  });
});


describe("複数コースと一時貸出の整合", () => {
  it("複数ラベルをORで絞り込み、未設定も併用できてNo順で重複しない", () => {
    const demo = initialDemo();
    expect(filterDrivers(demo, ["amazon", "toyonaka"], "all").map(d => d.id)).toEqual(["sato", "tanaka", "takahashi", "ito", "watanabe", "nakamura"]);
    expect(filterDrivers(demo, ["amazon", "unlabeled"], "DAILY").map(d => d.id)).toEqual(["takahashi", "ito", "kobayashi"]);
    expect(filterDrivers(demo, [], "all")).toHaveLength(9);
  });
  it("貸出中もコース追加・一部解除でき、最後の稼働の解除は拒否する", () => {
    const demo = initialDemo();
    const current = shiftFor(demo, "takahashi", "2026-09-02")!;
    const added = withCourse(current, "c", true);
    expect(validateShift(demo, added)).toBeNull();
    expect(courseIdsFor(added)).toEqual(["a", "c"]);
    expect(added.vehicleId).toBe(current.vehicleId);
    const removed = withCourse(added, "a", false);
    expect(validateShift(demo, removed)).toBeNull();
    expect(validateShift(demo, withCourse(removed, "c", false))).toContain("一時貸出と予定");
    expect(courseIdsFor(current)).toEqual(["a"]);
  });
  it("複数コースの日額は合算せず最大を1回とし、解除したら残った日額を使う", () => {
    const demo = initialDemo();
    const current = shiftFor(demo, "takahashi", "2026-09-02")!;
    demo.shifts = demo.shifts.map(s => s === current ? withCourse(current, "c", true) : s);
    expect(loanDailyRate(demo, demo.loans[0])).toBe(1800);
    demo.shifts = demo.shifts.map(s => s.driverId === current.driverId && s.date === current.date ? withCourse(s, "a", false) : s);
    expect(loanDailyRate(demo, demo.loans[0])).toBe(1500);
  });
});
