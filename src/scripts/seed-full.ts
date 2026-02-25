/**
 * フルシード: ドライバー10人、車両8台、2026年1月シフト・日報、コース単価
 * Run: npx tsx src/scripts/seed-full.ts
 */
import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";
import * as dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const COMPANY_CODE = "AAA";

const DRIVERS = [
  { name: "管理者", role: "ADMIN" as const, pin: "9999", office_code: "000000", driver_code: null as string | null, display_name: null as string | null, postal_code: "", address: "", phone: "", bank_institution: "", bank_branch: "", bank_type: "", bank_number: "", bank_holder: "" },
  { name: "田中太郎", role: "DRIVER" as const, pin: "111111", office_code: "000001", driver_code: "AAA111111", display_name: "田中", postal_code: "6150904", address: "京都市右京区梅津堤上町21", phone: "080-1234-5678", bank_institution: "京都信用金庫", bank_branch: "梅津支店", bank_type: "普通", bank_number: "3058832", bank_holder: "タナカ タロウ" },
  { name: "佐藤花子", role: "DRIVER" as const, pin: "222222", office_code: "000001", driver_code: "AAA222222", display_name: "佐藤", postal_code: "6008216", address: "京都市下京区東洞院通七条下ル", phone: "075-123-4567", bank_institution: "三菱UFJ銀行", bank_branch: "京都支店", bank_type: "普通", bank_number: "1234567", bank_holder: "サトウ ハナコ" },
  { name: "鈴木一郎", role: "DRIVER" as const, pin: "333333", office_code: "000001", driver_code: "AAA333333", display_name: "鈴木", postal_code: "6048004", address: "京都市中京区蛸薬師通新京極東入ル", phone: "090-9876-5432", bank_institution: "三井住友銀行", bank_branch: "四条支店", bank_type: "普通", bank_number: "7654321", bank_holder: "スズキ イチロウ" },
  { name: "山田花子", role: "DRIVER" as const, pin: "444444", office_code: "000002", driver_code: "AAA444444", display_name: "山田", postal_code: "6018042", address: "京都市南区東九条南松ノ木町", phone: "080-1111-2222", bank_institution: "京都銀行", bank_branch: "京都駅前支店", bank_type: "普通", bank_number: "1112222", bank_holder: "ヤマダ ハナコ" },
  { name: "高橋健太", role: "DRIVER" as const, pin: "555555", office_code: "000002", driver_code: "AAA555555", display_name: "高橋", postal_code: "6120014", address: "京都市伏見区深草西浦町", phone: "075-222-3333", bank_institution: "みずほ銀行", bank_branch: "京都中央支店", bank_type: "普通", bank_number: "2223333", bank_holder: "タカハシ ケンタ" },
  { name: "伊藤美咲", role: "DRIVER" as const, pin: "666666", office_code: "000002", driver_code: "AAA666666", display_name: "伊藤", postal_code: "6168384", address: "京都市右京区嵯峨越畑南大般若町", phone: "090-3333-4444", bank_institution: "りそな銀行", bank_branch: "京都支店", bank_type: "普通", bank_number: "3334444", bank_holder: "イトウ ミサキ" },
  { name: "渡辺亮", role: "DRIVER" as const, pin: "777777", office_code: "000003", driver_code: "AAA777777", display_name: "渡辺", postal_code: "6038143", address: "京都市北区紫野東蓮台野町", phone: "080-4444-5555", bank_institution: "楽天銀行", bank_branch: "本店", bank_type: "普通", bank_number: "4445555", bank_holder: "ワタナベ リョウ" },
  { name: "中村恵子", role: "DRIVER" as const, pin: "888888", office_code: "000003", driver_code: "AAA888888", display_name: "中村", postal_code: "6018392", address: "京都市南区久世殿城町", phone: "075-555-6666", bank_institution: "ゆうちょ銀行", bank_branch: "京都中央", bank_type: "普通", bank_number: "5556666", bank_holder: "ナカムラ ケイコ" },
  { name: "小林拓也", role: "DRIVER" as const, pin: "999999", office_code: "000003", driver_code: "AAA999999", display_name: "小林", postal_code: "6120861", address: "京都市伏見区深草大亀谷古御香町", phone: "090-6666-7777", bank_institution: "セブン銀行", bank_branch: "本店", bank_type: "普通", bank_number: "6667777", bank_holder: "コバヤシ タクヤ" },
  { name: "加藤直樹", role: "DRIVER" as const, pin: "121212", office_code: "000004", driver_code: "AAA121212", display_name: "加藤", postal_code: "6040952", address: "京都市中京区西ノ京南円町", phone: "080-7777-8888", bank_institution: "三菱UFJ銀行", bank_branch: "烏丸支店", bank_type: "普通", bank_number: "7778888", bank_holder: "カトウ ナオキ" },
  { name: "吉田麻衣", role: "DRIVER" as const, pin: "131313", office_code: "000004", driver_code: "AAA131313", display_name: "吉田", postal_code: "6050802", address: "京都市東山区大和大路通正面下る", phone: "075-888-9999", bank_institution: "三井住友銀行", bank_branch: "河原町支店", bank_type: "普通", bank_number: "8889999", bank_holder: "ヨシダ マイ" },
];

const VEHICLES = [
  { number_prefix: "京都", number_class: "400", number_hiragana: "わ", number_numeric: "12-34", current_mileage: 45200, manufacturer: "スズキ", brand: "エブリイ" },
  { number_prefix: "京都", number_class: "400", number_hiragana: "り", number_numeric: "56-78", current_mileage: 32500, manufacturer: "ダイハツ", brand: "ハイゼット" },
  { number_prefix: "京都", number_class: "481", number_hiragana: "と", number_numeric: "90-12", current_mileage: 58200, manufacturer: "日産", brand: "NV100" },
  { number_prefix: "京都", number_class: "400", number_hiragana: "さ", number_numeric: "34-56", current_mileage: 28900, manufacturer: "スズキ", brand: "エブリイ" },
  { number_prefix: "京都", number_class: "400", number_hiragana: "ね", number_numeric: "78-90", current_mileage: 41200, manufacturer: "ダイハツ", brand: "ハイゼット" },
  { number_prefix: "京都", number_class: "481", number_hiragana: "ほ", number_numeric: "11-22", current_mileage: 35600, manufacturer: "ホンダ", brand: "N-VAN" },
  { number_prefix: "京都", number_class: "400", number_hiragana: "き", number_numeric: "33-44", current_mileage: 47800, manufacturer: "スズキ", brand: "エブリイ" },
  { number_prefix: "京都", number_class: "400", number_hiragana: "る", number_numeric: "55-66", current_mileage: 52100, manufacturer: "ダイハツ", brand: "ハイゼット" },
  { number_prefix: "京都", number_class: "400", number_hiragana: "ぬ", number_numeric: "77-88", current_mileage: 38900, manufacturer: "スズキ", brand: "エブリイ" },
  { number_prefix: "京都", number_class: "481", number_hiragana: "を", number_numeric: "99-00", current_mileage: 44500, manufacturer: "ホンダ", brand: "N-VAN" },
  { number_prefix: "京都", number_class: "400", number_hiragana: "わ", number_numeric: "22-33", current_mileage: 51200, manufacturer: "ダイハツ", brand: "ハイゼット" },
];

// 指定した期間（含む）の全日付を返す
function getAllDaysInRange(startStr: string, endStr: string): string[] {
  const start = new Date(startStr);
  const end = new Date(endStr);
  const days: string[] = [];
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return days;
  const d = new Date(start);
  while (d <= end) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    days.push(`${y}-${m}-${day}`);
    d.setDate(d.getDate() + 1);
  }
  return days;
}

// 繁忙期の係数（7月と 11月下旬〜12月は少し個数を増やす）
function getBusyFactor(dateStr: string): number {
  const [, mStr, dStr] = dateStr.split("-");
  const m = Number(mStr);
  const d = Number(dStr);
  if (m === 7) return 1.2; // 7月はやや多め
  if (m === 11 && d >= 20) return 1.25; // 11月下旬
  if (m === 12) return 1.3; // 12月はさらに多め
  return 1;
}

// ランダムな宅急便・ネコポス実績（人によってばらつき）＋繁忙期係数
function randomReport(
  isHeavyDriver: boolean,
  busyFactor: number,
): { tkComp: number; tkRet: number; nkComp: number; nkRet: number } {
  const baseTk =
    isHeavyDriver
      ? 180 + Math.floor(Math.random() * 80)
      : 60 + Math.floor(Math.random() * 50);
  const tkBase = Math.round(baseTk * busyFactor);
  const tkRet = Math.floor(tkBase * (0.15 + Math.random() * 0.15));

  const baseNk = 20 + Math.floor(Math.random() * 60);
  const nkBase = Math.round(baseNk * busyFactor);
  const nkRet = Math.floor(Math.random() * 5);

  return {
    tkComp: Math.max(0, tkBase - tkRet),
    tkRet,
    nkComp: Math.max(0, nkBase - nkRet),
    nkRet,
  };
}

async function main() {
  console.log("=== フルシード開始 ===\n");

  // 1. コース取得
  const { data: courses, error: cErr } = await supabase.from("courses").select("id, name").order("sort_order");
  if (cErr || !courses?.length) {
    console.error("コース取得失敗:", cErr);
    return;
  }
  const courseMap = Object.fromEntries(courses.map((c) => [c.name, c.id]));
  const yamatoA = courseMap["ヤマトA"];
  const yamatoB = courseMap["ヤマトB"];
  const yamatoC = courseMap["ヤマトC"];
  const amazon = courseMap["Amazonミッドナイト"];

  // 2. コース単価更新
  await supabase.from("course_rates").upsert(
    courses.map((c) => ({
      course_id: c.id,
      takuhaibin_revenue: ["ヤマトA", "ヤマトB", "ヤマトC"].includes(c.name) ? 160 : 0,
      takuhaibin_profit: ["ヤマトA", "ヤマトB", "ヤマトC"].includes(c.name) ? 10 : 0,
      takuhaibin_driver_payout: ["ヤマトA", "ヤマトB", "ヤマトC"].includes(c.name) ? 150 : 0,
      nekopos_revenue: ["ヤマトA", "ヤマトB", "ヤマトC"].includes(c.name) ? 40 : 0,
      nekopos_profit: ["ヤマトA", "ヤマトB", "ヤマトC"].includes(c.name) ? 10 : 0,
      nekopos_driver_payout: ["ヤマトA", "ヤマトB", "ヤマトC"].includes(c.name) ? 30 : 0,
      fixed_revenue: c.name === "Amazonミッドナイト" ? 10000 : 0,
      fixed_profit: c.name === "Amazonミッドナイト" ? 4000 : 0,
      updated_at: new Date().toISOString(),
    })),
    { onConflict: "course_id" }
  );
  console.log("✓ コース単価を設定しました");

  // 3. rate_master更新（ドライバー支払い）
  await supabase.from("rate_master").upsert(
    [
      { kind: "TAKUHAIBIN", rate_per_completed: 150, updated_at: new Date().toISOString() },
      { kind: "NEKOPOS", rate_per_completed: 30, updated_at: new Date().toISOString() },
    ],
    { onConflict: "kind" }
  );
  console.log("✓ rate_masterを更新しました（宅急便150円、ネコポス30円）");

  // 4. ドライバー登録
  const driverIds: string[] = [];
  for (const d of DRIVERS) {
    const pinHash = d.role === "ADMIN" ? await bcrypt.hash(d.pin, 10) : await bcrypt.hash(d.pin, 10);
    const bankName = d.bank_institution && d.bank_branch ? `${d.bank_institution} ${d.bank_branch}` : null;
    const bankNo = d.bank_type && d.bank_number ? `${d.bank_type} ${d.bank_number}` : null;

    const { data: existing } = await supabase.from("drivers").select("id").eq("name", d.name).single();

    const payload = {
      name: d.name,
      role: d.role,
      pin_hash: pinHash,
      company_code: COMPANY_CODE,
      office_code: d.office_code,
      driver_code: d.driver_code,
      display_name: d.display_name,
      postal_code: d.postal_code || null,
      address: d.address || null,
      phone: d.phone || null,
      bank_name: bankName,
      bank_no: bankNo,
      bank_holder: d.bank_holder || null,
    };

    if (existing) {
      await supabase.from("drivers").update(payload).eq("id", existing.id);
      driverIds.push(existing.id);
      console.log(`✓ ${d.name} を更新`);
    } else {
      const { data: inserted, error } = await supabase.from("drivers").insert(payload).select("id").single();
      if (error) {
        console.error(`✗ ${d.name} 登録失敗:`, error.message);
      } else {
        driverIds.push(inserted.id);
        console.log(`✓ ${d.name} を登録`);
      }
    }
  }

  const driversForShift = DRIVERS.filter((d) => d.role === "DRIVER");
  const driverIdList = driverIds.slice(1); // admin除く

  // 5. driver_courses（全ドライバーに全コース紐付け）
  for (let i = 0; i < driverIdList.length; i++) {
    const did = driverIdList[i];
    for (const cid of [yamatoA, yamatoB, yamatoC, amazon]) {
      await supabase.from("driver_courses").upsert(
        { driver_id: did, course_id: cid },
        { onConflict: "driver_id,course_id" }
      );
    }
  }
  console.log("✓ driver_courses を設定");

  // 6. 車両登録（ナンバーで既存を検索、なければ挿入）
  const vehicleIds: string[] = [];
  for (const v of VEHICLES) {
    const { data: existing } = await supabase
      .from("vehicles")
      .select("id")
      .eq("number_prefix", v.number_prefix)
      .eq("number_class", v.number_class)
      .eq("number_hiragana", v.number_hiragana)
      .eq("number_numeric", v.number_numeric)
      .maybeSingle();
    const payload = {
      number_prefix: v.number_prefix,
      number_class: v.number_class,
      number_hiragana: v.number_hiragana,
      number_numeric: v.number_numeric,
      current_mileage: v.current_mileage,
      last_oil_change_mileage: v.current_mileage - 3000,
      oil_change_interval: 3000,
      manufacturer: v.manufacturer,
      brand: v.brand,
    };
    if (existing) {
      await supabase.from("vehicles").update(payload).eq("id", existing.id);
      vehicleIds.push(existing.id);
    } else {
      const { data: inserted, error } = await supabase.from("vehicles").insert(payload).select("id").single();
      if (!error && inserted) vehicleIds.push(inserted.id);
    }
  }
  // 既存3台も取得
  const { data: allVehicles } = await supabase.from("vehicles").select("id").order("manufacturer").order("brand");
  const allVehicleIds = allVehicles?.map((v) => v.id) ?? vehicleIds;
  console.log(`✓ 車両 ${allVehicleIds.length} 台`);

  // 7. vehicle_drivers（ドライバーと車両の紐付け、簡易に全員全車両）
  for (const did of driverIdList) {
    for (const vid of allVehicleIds) {
      await supabase.from("vehicle_drivers").upsert(
        { vehicle_id: vid, driver_id: did },
        { onConflict: "vehicle_id,driver_id" }
      );
    }
  }
  console.log("✓ vehicle_drivers を設定");

  // 8. シフト作成（2025-01-01 〜 2026-02-25 / ヤマトは各年 1/1〜1/4 休み）
  const SHIFT_START = "2025-01-01";
  const SHIFT_END = "2026-02-25";
  const allDays = getAllDaysInRange(SHIFT_START, SHIFT_END);
  const yamatoCourses = [yamatoA, yamatoB, yamatoC];
  let shiftCount = 0;

  for (const date of allDays) {
    const [, mStr, dStr] = date.split("-");
    const m = Number(mStr);
    const dNum = Number(dStr);
    const isYamatoOff = m === 1 && dNum >= 1 && dNum <= 4; // ヤマト休業期間（毎年 1/1〜1/4）

    let driverIdx = 0;
    if (!isYamatoOff) {
      for (const cid of yamatoCourses) {
        const did = driverIdList[driverIdx % driverIdList.length];
        await supabase.from("shifts").upsert(
          {
            shift_date: date,
            course_id: cid,
            driver_id: did,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "shift_date,course_id" },
        );
        shiftCount++;
        driverIdx++;
      }
    }
    const amazonDid = driverIdList[(driverIdx + 2) % driverIdList.length];
    await supabase.from("shifts").upsert(
      {
        shift_date: date,
        course_id: amazon,
        driver_id: amazonDid,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "shift_date,course_id" },
    );
    shiftCount++;
  }
  console.log(`✓ シフト ${shiftCount} 件（${SHIFT_START}〜${SHIFT_END}）`);

  // 9. 日報作成（シフトに紐づくドライバーの実績）
  const { data: shifts } = await supabase
    .from("shifts")
    .select("shift_date, course_id, driver_id")
    .gte("shift_date", SHIFT_START)
    .lte("shift_date", SHIFT_END);

  const reportByDriverDate = new Map<string, { tkComp: number; tkRet: number; nkComp: number; nkRet: number }>();

  shifts?.forEach((s) => {
    if (!s.driver_id) return;
    const key = `${s.driver_id}:${s.shift_date}`;
    const isAmazon = s.course_id === amazon;
    const isHeavy = Math.random() > 0.6;
    const busyFactor = getBusyFactor(s.shift_date);

    if (isAmazon) {
      // Amazonミッドナイトは実個数0（固定報酬）
      reportByDriverDate.set(key, {
        tkComp: 0,
        tkRet: 0,
        nkComp: 0,
        nkRet: 0,
      });
    } else {
      if (!reportByDriverDate.has(key)) {
        reportByDriverDate.set(key, randomReport(isHeavy, busyFactor));
      }
    }
  });

  for (const [key, report] of reportByDriverDate) {
    const [driverId, reportDate] = key.split(":");
    const shift = shifts?.find((s) => s.driver_id === driverId && s.shift_date === reportDate);
    const isAmazon = shift?.course_id === amazon;
    await supabase.from("daily_reports").upsert(
      {
        driver_id: driverId,
        report_date: reportDate,
        takuhaibin_completed: isAmazon ? 0 : report.tkComp,
        takuhaibin_returned: isAmazon ? 0 : report.tkRet,
        nekopos_completed: isAmazon ? 0 : report.nkComp,
        nekopos_returned: isAmazon ? 0 : report.nkRet,
        submitted_at: new Date().toISOString(),
      },
      { onConflict: "driver_id,report_date" }
    );
  }
  console.log(`✓ 日報 ${reportByDriverDate.size} 件（${SHIFT_START}〜${SHIFT_END}）`);

  console.log("\n=== シード完了 ===");
  console.log("\n【ログイン】");
  console.log("管理者: 会社コード AAA, PIN 9999");
  driversForShift.forEach((d, i) => {
    if (d.driver_code) console.log(`${d.name}: ${d.driver_code}`);
  });
}

main().catch(console.error);
