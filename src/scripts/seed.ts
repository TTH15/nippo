/**
 * Seed script: creates sample drivers.
 * Run: npx tsx src/scripts/seed.ts
 * Requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.local
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
  { 
    name: "管理者", 
    role: "ADMIN", 
    pin: "9999",
    company_code: COMPANY_CODE,
    office_code: "000000",
    driver_code: null, // 管理者にはドライバーコードなし
  },
  { 
    name: "田中太郎", 
    role: "DRIVER", 
    pin: "111111", // 6桁に変更
    company_code: COMPANY_CODE,
    office_code: "000001",
    driver_code: "AAA111111",
  },
  { 
    name: "佐藤花子", 
    role: "DRIVER", 
    pin: "222222",
    company_code: COMPANY_CODE,
    office_code: "000001",
    driver_code: "AAA222222",
  },
  { 
    name: "鈴木一郎", 
    role: "DRIVER", 
    pin: "333333",
    company_code: COMPANY_CODE,
    office_code: "000001",
    driver_code: "AAA333333",
  },
];

async function main() {
  for (const d of DRIVERS) {
    // まず既存のドライバーをチェック
    const { data: existing } = await supabase
      .from("drivers")
      .select("id")
      .eq("name", d.name)
      .single();

    if (existing) {
      // 既存のドライバーを更新（新しいフィールドを追加）
      const pinHash = await bcrypt.hash(d.pin, 10);
      const { error } = await supabase
        .from("drivers")
        .update({ 
          pin_hash: pinHash,
          company_code: d.company_code,
          office_code: d.office_code,
          driver_code: d.driver_code,
        })
        .eq("id", existing.id);
      
      if (error) {
        console.error(`Failed to update ${d.name}:`, error.message);
      } else {
        console.log(`✓ ${d.name} を更新しました`);
      }
      continue;
    }

    const pinHash = await bcrypt.hash(d.pin, 10);
    const { data, error } = await supabase
      .from("drivers")
      .insert({ 
        name: d.name, 
        role: d.role, 
        pin_hash: pinHash,
        company_code: d.company_code,
        office_code: d.office_code,
        driver_code: d.driver_code,
      })
      .select()
      .single();

    if (error) {
      console.error(`Failed to insert ${d.name}:`, error.message);
    } else {
      console.log(`✓ ${d.name} (${d.role}) — id: ${data.id}`);
    }
  }
  
  console.log("\nDone!");
  console.log("\n--- ログイン情報 ---");
  console.log("\n【管理者】");
  console.log(`  会社コード: ${COMPANY_CODE}`);
  console.log(`  PIN: 9999`);
  console.log("\n【ドライバー】");
  DRIVERS.filter(d => d.role === "DRIVER").forEach((d) => {
    console.log(`  ${d.name}: ${d.driver_code}`);
  });
}

main().catch(console.error);
