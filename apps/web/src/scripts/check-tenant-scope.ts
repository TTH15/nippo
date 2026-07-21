/**
 * テナント分離の静的検査。
 *
 * 背景: 構成A（RLS 不使用・service role で接続）のため、テナント分離は
 * アプリ層の `.eq("org_id", orgId)` だけが支えている。1箇所の書き忘れが
 * そのまま他社データの露出になる（実際に vehicles-unlinked / admin/shifts /
 * oil-alert-count の3件で発生した）。
 *
 * この検査は「テナント列を持つテーブルへのクエリに org 絞りがあるか」を
 * 機械的に確認する。RLS の代わりの二重防御。
 *
 * Run: cd apps/web && npx tsx src/scripts/check-tenant-scope.ts
 * CI 用: 違反があれば exit 1。
 */
import fs from "fs";
import path from "path";

const ROOT = path.resolve(process.cwd(), "src");
const MIGRATIONS = path.resolve(process.cwd(), "../../supabase/migrations");

/** migration から「org_id / owner_org_id を持つテーブル」を抽出する。 */
function loadTenantTables(): Map<string, string> {
  const tables = new Map<string, string>(); // table -> column
  for (const file of fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql"))) {
    const sql = fs.readFileSync(path.join(MIGRATIONS, file), "utf8");

    // ALTER TABLE x ADD COLUMN ... org_id
    for (const m of sql.matchAll(
      /ALTER TABLE\s+([a-z0-9_]+)\s+ADD COLUMN(?:\s+IF NOT EXISTS)?\s+(org_id|owner_org_id)\b/gi,
    )) {
      tables.set(m[1], m[2]);
    }

    // CREATE TABLE x ( ... org_id ... )
    for (const m of sql.matchAll(
      /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+([a-z0-9_]+)\s*\(([\s\S]*?)\n\);/gi,
    )) {
      const [, table, body] = m;
      const col = /\b(owner_org_id)\b/.test(body)
        ? "owner_org_id"
        : /\b(org_id)\b/.test(body)
          ? "org_id"
          : null;
      if (col) tables.set(table, col);
    }
  }
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

  const src = fs.readFileSync(file, "utf8");
  const lines = src.split("\n");
  const violations: Violation[] = [];

  for (const m of src.matchAll(/\.from\(\s*["'`]([a-z0-9_]+)["'`]\s*\)/g)) {
    const table = m[1];
    const column = tenantTables.get(table);
    if (!column) continue;

    const lineNo = src.slice(0, m.index).split("\n").length;

    // クエリは複数行チェーンなので、その行から続く塊（次の from か空行まで）を見る
    const chunk = lines.slice(lineNo - 1, lineNo + 14).join("\n");
    const chunkUntilNext = chunk.split(/\.from\(/).slice(0, 2).join("");

    const hasOrgFilter =
      new RegExp(`\\.eq\\(\\s*["'\`]${column}["'\`]`).test(chunkUntilNext) ||
      // 入れ子 join 経由（courses!inner(org_id) 等）
      new RegExp(`["'\`][a-z0-9_]+\\.${column}["'\`]`).test(chunkUntilNext) ||
      // 主キー指定で1行に特定 → 呼び出し側で org 検証する前提のもの
      /\.eq\(\s*["'`]id["'`]/.test(chunkUntilNext) ||
      // 書き込み時に org を埋めている（insert/upsert の値に org_id: が入る）
      new RegExp(`${column}\\s*:`).test(chunkUntilNext) ||
      // 事前に org スコープで取得した ID 集合で絞っている（.in("id", xxxIds)）
      /\.in\(\s*["'`]id["'`]/.test(chunkUntilNext) ||
      // 明示的な除外コメント
      /tenant-scope-ok/.test(chunkUntilNext);

    if (!hasOrgFilter) {
      violations.push({
        file: rel,
        line: lineNo,
        table,
        snippet: (lines[lineNo - 1] ?? "").trim(),
      });
    }
  }
  return violations;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

function main() {
  const tenantTables = loadTenantTables();
  console.log(`[tenant-scope] テナント列を持つテーブル: ${tenantTables.size}件`);

  const files = walk(ROOT);
  const violations = files.flatMap((f) => scanFile(f, tenantTables));

  if (violations.length === 0) {
    console.log("[tenant-scope] ✅ org 絞りの漏れは見つかりませんでした");
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
    "\n  対処: .eq(\"org_id\", orgId) を追加するか、意図的なら行末に // tenant-scope-ok: 理由 を書く",
  );
  process.exitCode = 1;
}

main();
