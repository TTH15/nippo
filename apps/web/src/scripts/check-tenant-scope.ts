/**
 * テナント分離の静的検査。
 *
 * 背景: 構成A（RLS 不使用・service role で接続）のため、テナント分離は
 * アプリ層の `.eq("org_id", orgId)` だけが支えている。1箇所の書き忘れが
 * そのまま他社データの露出になる（実際に vehicles-unlinked / admin/shifts /
 * oil-alert-count の3件で発生した）。
 *
 * テナント列を持つ表のorg絞りと、指定した親経由表の審査コメントを
 * 機械的に確認する。RLSを迂回するservice role接続の補助検査。
 *
 * Run: cd apps/web && npx tsx src/scripts/check-tenant-scope.ts
 * CI 用: 違反があれば exit 1。
 */
import fs from "fs";
import path from "path";

const ROOT = path.resolve(process.cwd(), "src");
const MIGRATIONS = path.resolve(process.cwd(), "../../supabase/migrations");

import { scanTenantQueries, tenantTablesFromSql } from "./tenantScopeScanner";

function loadTenantTables(): Map<string, string> {
  const tables = new Map<string, string>();
  for (const file of fs.readdirSync(MIGRATIONS).filter(f => f.endsWith(".sql"))) {
    for (const [table, column] of tenantTablesFromSql(fs.readFileSync(path.join(MIGRATIONS, file), "utf8"))) tables.set(table, column);
  }
  // org列を持たず親の所属で境界が決まる子テーブル。新規クエリには
  // 親のorg確認を明示した tenant-scope-ok を必須にする。
  tables.set("vehicle_recovery_entries", "__parent_vehicle_scope__");
  tables.set("vehicle_recovery_collected", "__parent_vehicle_scope__");
  return tables;
}

/**
 * 除外してよい呼び出し。
 * - 主キー等で1行に特定したうえで、別途 org を検証しているもの
 * - org 自体を解決するための問い合わせ（resolveOrgId）
 * 行末に `// tenant-scope-ok: 理由` を書くと個別に除外できる。
 */
const ALLOWLIST_FILES = new Set<string>([
  "src/server/db/tenant.ts", // org_id の解決そのもの
  "src/scripts/check-tenant-scope.ts",
]);

type Violation = { file: string; line: number; table: string; snippet: string };

function scanFile(file: string, tenantTables: Map<string, string>): Violation[] {
  const rel = path.relative(process.cwd(), file);
  if (ALLOWLIST_FILES.has(rel)) return [];

  return scanTenantQueries(fs.readFileSync(file, "utf8"), tenantTables).map(issue => ({ ...issue, file: rel }));
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    // .tmp-import など、ドット始まりは使い捨てスクリプトの置き場。本番経路ではないので見ない
    if (entry.name.startsWith(".")) continue;
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name) && ! /\.(test|spec|itest)\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

function main() {
  const tenantTables = loadTenantTables();
  console.log(`[tenant-scope] 静的検査対象テーブル: ${tenantTables.size}件（親経由2件を含む）`);

  const files = walk(ROOT);
  const violations = files.flatMap((f) => scanFile(f, tenantTables));

  if (violations.length === 0) {
    console.log("[tenant-scope] ✅ 未審査のクエリは見つかりませんでした");
    return;
  }

  console.log(`\n[tenant-scope] ⚠️ org 絞りが確認できないクエリ: ${violations.length}件\n`);
  const byFile = new Map<string, Violation[]>();
  for (const v of violations) {
    byFile.set(v.file, [...(byFile.get(v.file) ?? []), v]);
  }
  for (const [file, list] of [...byFile].sort()) {
    console.log(`  ${file}`);
    for (const v of list) {
      console.log(`    :${v.line}  ${v.table}  ${v.snippet}`);
    }
  }
  console.log(
    "\n  対処: 会社列のある表はorgで絞る。親経由表は親の所属を確認し、// tenant-scope-ok: 理由 を記す",
  );
  process.exitCode = 1;
}

main();
