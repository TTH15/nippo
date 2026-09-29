// API 入口と直接の認可ガードをコードから棚卸しする。実行: node scripts/generate-api-permissions.mjs
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = path.resolve("apps/web/src/app/api");
const output = path.resolve("docs/development/api-permissions.md");
const catalogOutput = path.resolve("apps/web/src/lib/routePermissionsCatalog.json");
const roleCatalogOutput = path.resolve("apps/web/src/lib/roleCatalog.json");
const capabilitiesSource = fs.readFileSync(path.resolve("apps/web/src/server/auth/capabilities.ts"), "utf8");
const domainCapsSource = fs.readFileSync(path.resolve("apps/web/src/server/auth/domainCaps.ts"), "utf8");
const domainCaps = new Map([...domainCapsSource.matchAll(/export const ([A-Z_]+): Capability\[\] = (\[[^;]+\]);/g)].map((match) => [match[1], match[2]]));
const methods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const guarded = new Set(["requirePermission", "requireAnyPermission", "requireScopedPermission", "requireAuth", "requireTenant"]);
const segmentLabels = {
  admin: "管理", auth: "認証", me: "本人", reports: "日報", shifts: "シフト", work: "稼働", vehicles: "車両",
  account: "アカウント", attendance: "出勤", badges: "件数バッジ", counterparties: "取引先", daily: "日報", all: "全件",
  approve: "承認", reject: "差戻し", proxy: "代理入力", summary: "集計", "day-summary": "日別集計", "day-summary-range": "期間集計",
  "report-form": "日報フォーム", "unread-count": "未読件数", "driver-ad-hoc-expenses": "ドライバー臨時経費",
  "driver-expenses": "ドライバー経費", "driver-lease": "ドライバーリース", "driver-rewards": "ドライバー報酬",
  "course-billing": "コース請求", "course-rates": "コース単価", "course-report-fields": "コース報告項目", cycles: "便",
  drivers: "ドライバー", events: "イベント", members: "メンバー", points: "ポイント", "billing-detail": "請求明細",
  "custom-lines": "調整行", "line-label": "行名", "merge-lines": "行統合", "merged-lines": "統合行", "month-lines": "月別明細",
  "vehicle-colors": "車両色", "shift-slots": "シフト枠", "join-code": "参加コード", "report-kinds": "報告種別",
  users: "メンバー", roles: "ロール", invoices: "請求書", billing: "請求", rewards: "報酬", payments: "支払",
  organization: "会社設定", org: "会社設定", courses: "コース", carriers: "キャリア", notifications: "通知",
  "record-forms": "記録フォーム", records: "記録", forms: "フォーム", "shift-memos": "シフトメモ",
  "shift-requests": "希望休", requests: "申請", "vehicle-loans": "車両貸出", "vehicle-qr": "車両QR",
  "spot-jobs": "スポット案件", "source-images": "原票画像", "photo-capture-tasks": "撮影項目", location: "位置情報",
  parking: "駐車", "check-in": "稼働開始", "check-out": "退勤", dashboard: "ダッシュボード", map: "地図",
  join: "参加", otp: "認証コード", line: "LINE", webhook: "Webhook", cron: "定期処理",
};
const special = new Map([
  ["POST /api/apply", "公開応募。入力検証・レート制限を個別確認"],
  ["POST /api/auth/login", "公開ログイン。資格情報を検証"],
  ["GET /api/join/lookup", "公開の参加コード照会。コードを検証"],
  ["POST /api/otp/send", "認証コード送信。送信先・レート制限を検証"],
  ["POST /api/line/webhook", "LINE署名を検証する外部Webhook"],
  ["GET /api/cron/daily-notifications", "CRON_SECRETで認証する定期処理"],
  ["POST /api/auth/recover/verify", "公開のアカウント復旧。復旧コード等を検証"],
  ["POST /api/auth/webauthn/login/options", "公開のPasskeyログイン開始。チャレンジを発行"],
  ["POST /api/auth/webauthn/login/verify", "公開のPasskeyログイン。署名とチャレンジを検証"],
  ["POST /api/join", "公開の会社参加。招待コードと登録内容を検証"],
  ["GET /api/platform/applications", "プラットフォーム運営者限定"],
  ["PATCH /api/platform/applications/[id]", "プラットフォーム運営者限定"],
  ["GET /api/platform/orgs", "プラットフォーム運営者限定"],
  ["GET /api/work/location", "認証＋会社所属＋本人の稼働セッション"],
  ["POST /api/work/location", "認証＋会社所属＋本人の稼働セッション"],
]);
const delegated = new Map([
  ["GET /api/record-forms", "認証＋フォームごとの閲覧範囲。管理はcan_manage_record_forms"],
  ["POST /api/record-forms", "can_manage_record_forms"],
  ["PUT /api/record-forms/[formId]", "can_manage_record_forms"],
  ["GET /api/record-forms/[formId]/records", "認証＋フォームごとの閲覧範囲"],
  ["POST /api/record-forms/[formId]/records", "認証＋フォームごとの提出/管理範囲"],
  ["GET /api/record-forms/[formId]/records/[recordId]", "認証＋フォーム・記録ごとの閲覧範囲"],
  ["PATCH /api/record-forms/[formId]/records/[recordId]", "認証＋フォーム・記録ごとの編集範囲"],
]);

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(dir, entry.name);
    return entry.isDirectory() ? files(target) : entry.name === "route.ts" ? [target] : [];
  });
}
function walk(node, callback) {
  callback(node);
  ts.forEachChild(node, (child) => walk(child, callback));
}
function textOf(source, node) { return node?.getText(source) ?? ""; }
function authOf(source, body, constants) {
  const found = [];
  walk(body, (node) => {
    if (!ts.isCallExpression(node)) return;
    const name = ts.isIdentifier(node.expression) ? node.expression.text : "";
    if (!guarded.has(name)) return;
    let detail = textOf(source, node.arguments[1]);
    for (let i = 0; i < 3 && constants.has(detail); i++) detail = constants.get(detail);
    detail = detail.replace(/\b([A-Z][A-Z_]+)\b/g, (name) => constants.get(name) ?? domainCaps.get(name) ?? name);
    detail = detail.replace(/\b([A-Z][A-Z_]+)\b/g, (name) => domainCaps.get(name) ?? name).replace(/\s+/g, " ");
    if (name === "requirePermission") found.push(detail.replaceAll('"', ""));
    else if (name === "requireAnyPermission") found.push(`いずれか ${detail.replaceAll('"', "")}`);
    else if (name === "requireScopedPermission") found.push(`範囲 ${detail.replace(/\s+/g, " ").replaceAll('"', "")}`);
    else found.push(name === "requireTenant" ? "認証＋会社所属" : "認証（本人・対象範囲は処理内で確認）");
  });
  return [...new Set(found)].join(" / ");
}
function description(method, endpoint) {
  const segments = endpoint.split("/").slice(2).filter((s) => s !== "admin" && !s.startsWith("["));
  const terminalAction = { approve: "承認", reject: "差戻し", activate: "有効化", deactivate: "無効化", verify: "検証", resolve: "照会", send: "送信" }[segments.at(-1)];
  if (method === "POST" && terminalAction) return `${segments.slice(0, -1).map((s) => segmentLabels[s] ?? s.replaceAll("-", " ")).join("・")}を${terminalAction}`;
  const target = segments.map((s) => segmentLabels[s] ?? s.replaceAll("-", " ")).join("・");
  const action = { GET: "取得", POST: "作成・送信", PUT: "更新", PATCH: "一部更新", DELETE: "削除" }[method];
  return `${target}の${action}`;
}
const rows = [];
for (const file of files(root)) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const endpoint = "/api/" + path.relative(root, path.dirname(file)).split(path.sep).join("/");
  const constants = new Map();
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const decl of statement.declarationList.declarations) {
      if (ts.isIdentifier(decl.name) && decl.initializer) constants.set(decl.name.text, textOf(source, decl.initializer));
    }
  }
  for (const statement of source.statements) {
    let method;
    let body;
    if (ts.isFunctionDeclaration(statement) && statement.name && methods.has(statement.name.text)) {
      method = statement.name.text; body = statement.body;
    } else if (ts.isVariableStatement(statement) && statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
      const decl = statement.declarationList.declarations.find((d) => ts.isIdentifier(d.name) && methods.has(d.name.text));
      if (decl) { method = decl.name.text; body = decl.initializer; }
    }
    if (!method || !body) continue;
    const key = `${method} ${endpoint}`;
    let guard = delegated.get(key) ?? authOf(source, body, constants);
    if (!guard) guard = special.get(key) ?? "個別条件を要確認";
    const comments = source.text.slice(statement.pos, statement.getStart(source));
    const methodComment = comments.match(new RegExp(`//\\s*${method}\\s*[:：]\\s*([^\\n]+)`));
    const commentDescription = methodComment?.[1]?.trim().replace(/[。．]\s*$/, "");
    const summary = commentDescription && /[\u3040-\u30ff\u3400-\u9fff]/.test(commentDescription) && commentDescription.length < 110
      ? commentDescription : description(method, endpoint);
    rows.push({ method, endpoint, description: summary, guard });
  }
}
rows.sort((a, b) => a.endpoint.localeCompare(b.endpoint) || a.method.localeCompare(b.method));
const line = (row) => `| ${row.method} | \`${row.endpoint}\` | ${row.description.replaceAll("|", "\\|")} | ${row.guard.replaceAll("|", "\\|")} |`;
const groups = new Map();
for (const row of rows) {
  const area = row.endpoint.split("/")[2];
  if (!groups.has(area)) groups.set(area, []);
  groups.get(area).push(row);
}
const sections = [...groups].map(([area, items]) => `## ${segmentLabels[area] ?? area}（${items.length}件）\n\n| Method | エンドポイント | APIの概要 | 入口の権限・条件 |\n| --- | --- | --- | --- |\n${items.map(line).join("\n")}`);
const capabilityBlock = (capabilitiesSource.match(/export const CAPABILITIES = \[([\s\S]*?)\] as const/) ?? [])[1] ?? "";
const capabilityNames = [...capabilityBlock.matchAll(/^\s*"(can_[a-z_]+)",/gm)].map((match) => match[1]);
const metaLabels = new Map([...capabilitiesSource.matchAll(/^\s*(can_[a-z_]+): \{ label: "([^"]+)"/gm)].map((match) => [match[1], match[2]]));
const roleBundle = (key) => new Set([...((capabilitiesSource.match(new RegExp(`  ${key}: \\[([\\s\\S]*?)\\],`)) ?? [])[1] ?? "").matchAll(/"(can_[a-z_]+)"/g)].map((match) => match[1]));
const accounting = roleBundle("ACCOUNTING");
const viewer = roleBundle("ADMIN_VIEWER");
const permissionTable = capabilityNames.map((capability) => `| \`${capability}\` | ${metaLabels.get(capability) ?? ""} | ○ | ${accounting.has(capability) ? "○" : "—"} | ${viewer.has(capability) ? "○" : "—"} | — |`).join("\n");
const doc = `# API・権限一覧\n\nこの表は \`node scripts/generate-api-permissions.mjs\` でAPIルートの実装から生成する。対象は ${rows.length} 操作（${files(root).length} ルート）。\n\n- 「入口の権限・条件」はルート先頭のガードを示す。会社・所有者・対象状態・追加権限などの処理内条件も適用されるため、この列だけで実行可否は確定しない。\n- \`requireAuth(req, "DRIVER")\` はDRIVERロール限定ではない。認証済み本人の操作を表し、所属状態も検証する。\n- \`can_*\` は会社内ロールの権限。管理者は全権限固定、カスタムロール・経理・閲覧者の実際の付与は会社ごとの \`role_capabilities\` を参照する。下表は旧ロールデータの既定値であり、現在の会社で付与された権限は「ロール・権限」画面を参照する。\n- 自分の希望休などは \`works_as_driver\` の本人権限も使う。公開API、LINE Webhook、cronは通常のロール認証と別の検証を行う。\n- 「個別条件を要確認」は自動抽出できなかった箇所。MCP等の外部公開前に手動監査する。\n\n## 権限と既定ロール\n\n| 権限 | 操作範囲 | 管理者 | 経理 | 閲覧者 | ドライバー |\n| --- | --- | :---: | :---: | :---: | :---: |\n${permissionTable}\n\n「ドライバーとして扱う」が有効なメンバーには、ロールを問わず本人の日報提出、希望休管理、シフト・報酬閲覧、プロフィール管理の本人権限が付く。本人権限は全社の \`can_*\` と別に判定される。\n\n${sections.join("\n\n")}\n`;
const writeOrCheck = (file, content) => {
  if (process.argv.includes("--check")) {
    if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== content) {
      console.error(`API権限カタログが古い: ${file}`);
      process.exitCode = 1;
    }
  } else {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
};
writeOrCheck(output, doc);
writeOrCheck(catalogOutput, JSON.stringify(rows, null, 2) + "\n");
const roleExports = {};
const compiledRoleCatalog = ts.transpileModule(capabilitiesSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
new Function("exports", compiledRoleCatalog)(roleExports);
writeOrCheck(roleCatalogOutput, JSON.stringify({
  capabilities: roleExports.CAPABILITIES,
  defaultRoleCapabilities: roleExports.DEFAULT_ROLE_CAPABILITIES,
  permissionRows: roleExports.PERMISSION_ROWS,
  capabilityImplies: roleExports.CAPABILITY_IMPLIES,
}, null, 2) + "\n");
const unknown = rows.filter((r) => r.guard === "個別条件を要確認");
console.log(`${rows.length} operations, ${unknown.length} unknown guards: ${output}`);
for (const row of unknown) console.log(`${row.method} ${row.endpoint}`);
if (unknown.length) process.exitCode = 1;
