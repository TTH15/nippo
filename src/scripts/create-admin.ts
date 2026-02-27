/**
 * Create / update an ADMIN account in `drivers`.
 *
 * Usage:
 *   # フル権限の管理者
 *   npx tsx src/scripts/create-admin.ts --company ACE --admin 8888 --password '(wsne=v4jiXw' --name '管理者'
 *   npx tsx src/scripts/create-admin.ts --adminCode ACE8888 --password '(wsne=v4jiXw' --name '管理者'
 *
 *   # 閲覧専用（ADMIN_VIEWER）
 *   npx tsx src/scripts/create-admin.ts --adminCode ACE9999 --password 'viewer-pass-123' --name '閲覧専用' --readonly
 *
 * Requires:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.local (or environment)
 */
import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";
import * as dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

function getArg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i < 0) return undefined;
  const v = process.argv[i + 1];
  if (!v || v.startsWith("--")) return undefined;
  return v;
}

function fail(msg: string): never {
  console.error(`\n[create-admin] ${msg}\n`);
  process.exit(1);
}

const company = (getArg("--company") ?? "").toUpperCase();
const adminNo = getArg("--admin") ?? "";
const adminCode = (getArg("--adminCode") ?? "").toUpperCase();
const password = getArg("--password") ?? "";
const name = getArg("--name") ?? "管理者";
const isReadonly = process.argv.includes("--readonly");

const resolvedAdminCode =
  adminCode ||
  (company && adminNo ? `${company}${adminNo}` : "");

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  fail("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (set in .env.local)");
}

if (!resolvedAdminCode) {
  fail("Missing admin code. Use --adminCode ACE8888 or --company ACE --admin 8888");
}
if (!/^[A-Z]{3}\d{4,8}$/.test(resolvedAdminCode)) {
  fail(`Invalid adminCode format: "${resolvedAdminCode}" (expected e.g. ACE8888)`);
}
if (password.length < 8) {
  fail("Password must be 8+ characters");
}

const resolvedCompany = resolvedAdminCode.slice(0, 3);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

async function main() {
  const pinHash = await bcrypt.hash(password, 10);

  // Create company row if exists (optional)
  await supabase
    .from("companies")
    .upsert({ code: resolvedCompany, name: resolvedCompany }, { onConflict: "code" });

  const payload = {
    name,
    role: isReadonly ? "ADMIN_VIEWER" as const : "ADMIN" as const,
    company_code: resolvedCompany,
    office_code: "000000",
    driver_code: resolvedAdminCode,
    pin_hash: pinHash,
  };

  const { data, error } = await supabase
    .from("drivers")
    .upsert(payload, { onConflict: "driver_code" })
    .select("id, name, role, company_code, driver_code")
    .single();

  if (error) {
    fail(`Failed to upsert admin: ${error.message}`);
  }

  console.log("\n✓ ADMIN account is ready");
  console.log(`- company_code: ${data.company_code}`);
  console.log(`- admin_code  : ${data.driver_code}`);
  console.log(`- name        : ${data.name}`);
  console.log("\n(Password is stored as bcrypt hash; not printed)");
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));

