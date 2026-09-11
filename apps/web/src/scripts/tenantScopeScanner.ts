import ts from "typescript";

export type ScopeIssue = { line: number; table: string; operation: string; snippet: string };

/** 同じクエリの構文木だけを見る。隣のクエリ・15行以降・id指定に依存しない。 */
export function scanTenantQueries(source: string, tables: Map<string, string>): ScopeIssue[] {
  const file = ts.createSourceFile("query.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const issues: ScopeIssue[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "from" && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) {
      const table = node.arguments[0].text;
      const column = tables.get(table);
      if (column) {
        const calls: ts.CallExpression[] = [];
        let end: ts.Node = node;
        while (ts.isPropertyAccessExpression(end.parent) && ts.isCallExpression(end.parent.parent) && end.parent.parent.expression === end.parent) {
          end = end.parent.parent;
          calls.push(end as ts.CallExpression);
        }
        const method = (call: ts.CallExpression) => (call.expression as ts.PropertyAccessExpression).name.text;
        const operation = calls.find(c => ["insert", "upsert", "update", "delete"].includes(method(c)));
        const name = operation ? method(operation) : "select";
        const line = file.getLineAndCharacterOfPosition(node.expression.name.getStart(file)).line;
        const lines = source.split("\n");
        const trailing = source.slice(end.end, source.indexOf("\n", end.end) < 0 ? undefined : source.indexOf("\n", end.end));
        const exception = /^[\s;),]*\/\/\s*tenant-scope-ok:\s*\S/.test(trailing) || /\/\/\s*tenant-scope-ok:\s*\S/.test(source.slice(node.getStart(file), end.end)) ||
          /^\s*\/\/\s*tenant-scope-ok:\s*\S/.test(lines[line - 1] ?? "");
        const filter = calls.some(c => method(c) === "eq" && c.arguments[0] && ts.isStringLiteralLike(c.arguments[0]) && c.arguments[0].text === column);
        // INSERTのorg値は別変数なら、人が割り当て元を確認して例外理由を残す。
        const payload = operation?.arguments[0];
        const hasColumn = (n: ts.Node): boolean => ts.isObjectLiteralExpression(n)
          ? n.properties.some(p => ts.isPropertyAssignment(p) && p.name.getText(file).replace(/["']/g, "") === column)
          : ts.isArrayLiteralExpression(n) && n.elements.length > 0 && n.elements.every(hasColumn);
        const insert = ["insert", "upsert"].includes(name) && payload && hasColumn(payload);
        if (!exception && !filter && !insert) issues.push({ line: line + 1, table, operation: name, snippet: (lines[line] ?? "").trim() });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return issues;
}

export function tenantTablesFromSql(sql: string): Map<string, string> {
  const tables = new Map<string, string>();
  const qualified = '(?:public\\.)?([a-z0-9_]+)';
  for (const m of sql.matchAll(new RegExp(`ALTER TABLE\\s+${qualified}\\s+ADD COLUMN(?:\\s+IF NOT EXISTS)?\\s+(org_id|owner_org_id)\\b`, "gi"))) tables.set(m[1], m[2]);
  for (const m of sql.matchAll(new RegExp(`CREATE TABLE(?:\\s+IF NOT EXISTS)?\\s+${qualified}\\s*\\(([\\s\\S]*?)\\n\\);`, "gi"))) {
    const column = /\bowner_org_id\b/.test(m[2]) ? "owner_org_id" : /\borg_id\b/.test(m[2]) ? "org_id" : null;
    if (column) tables.set(m[1], column);
  }
  return tables;
}
