import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import { mkdtemp, readFile, writeFile, access, mkdir, copyFile, readdir } from "node:fs/promises";
import { createServer } from "node:http";

// Standalone, loopback-only mock runner. Never load server code or application secrets.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "apps/web/package.json"));
const { build } = require("esbuild");
const postcss = require("postcss");
const tailwind = require("tailwindcss");
const loadConfig = require("tailwindcss/loadConfig");
const args = process.argv.slice(2);
const feature = args[0] && !args[0].startsWith("--") ? args[0] : "driver-leases";
if (!/^[a-z0-9-]+$/.test(feature)) throw new Error("Invalid preview name");
const portIndex = args.indexOf("--port");
const port = portIndex === -1 ? 3191 : Number(args[portIndex + 1]);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid port");
const mapboxEnabled = args.includes("--mapbox");
const mapboxFeatures = new Set(["driver-leases", "map-operations", "admin", "vehicles"]);
if (mapboxEnabled && !mapboxFeatures.has(feature)) throw new Error("Mapbox mode is not available for this preview");
let publicMapboxToken = "";
if (mapboxEnabled) {
  // 明示的なMapboxモードだけ公開キー1項目を取得する。他の環境変数はロードしない。
  publicMapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";
  if (!publicMapboxToken) {
    const envText = await readFile(path.join(root, "apps/web/.env.local"), "utf8").catch(() => "");
    publicMapboxToken = envText.match(/^\s*(?:export\s+)?NEXT_PUBLIC_MAPBOX_TOKEN\s*=\s*["']?(pk\.[A-Za-z0-9._-]+)/m)?.[1] ?? "";
  }
  if (!/^pk\.[A-Za-z0-9._-]+$/.test(publicMapboxToken)) throw new Error("Mapbox mode requires NEXT_PUBLIC_MAPBOX_TOKEN (public pk. token only)");
}
const source = path.join(root, "apps/web/src");
// 本番ページ本体を検証する専用entry。Nextの公開ルートには置かない。
const productionPageEntries = new Map([
  ["shifts", path.join(root, "scripts/previews/shifts.tsx")],
  // admin: 複数の本番ページを fixture で開く runner（/preview/admin/<slug>?scenario=&role=）。
  // vehicles は旧コマンド互換のエイリアスで、同じ bundle を /preview/admin/vehicles で開く。
  ["admin", path.join(root, "scripts/previews/admin.tsx")],
  ["vehicles", path.join(root, "scripts/previews/admin.tsx")],
]);
const isAdminRunner = feature === "admin" || feature === "vehicles";
// admin runner が差し替えるモジュール。@/lib/useApi・@/lib/swr・@/lib/capabilities は本物を使い、
// その内側の "swr" と "@/lib/api" だけを fixture ストアへ向ける（本番コードとの乖離を最小にする）。
const adminReplacements = new Map([
  ["@/lib/api", "kernel/services.tsx"],
  ["swr", "kernel/swr.tsx"],
  ["swr/infinite", "kernel/swr-infinite.tsx"],
  ["next/link", "kernel/next-link.tsx"],
  ["next/navigation", "kernel/next-navigation.tsx"],
  ["next/image", "kernel/next-image.tsx"],
  ["next/dynamic", "kernel/next-dynamic.tsx"],
  ["@/lib/components/AdminLayout", "kernel/AdminLayout.tsx"],
  ["@/lib/components/VehicleModelPreview", "kernel/VehicleModelPreview.tsx"],
  ["@/lib/map/sharedView", "kernel/sharedView.tsx"],
].map(([from, to]) => [from, path.join(root, "scripts/previews", to)]));
const entry = productionPageEntries.get(feature) ?? path.join(source, "app/preview", feature, "page.tsx");
await access(entry);
const output = await mkdtemp(path.join(os.tmpdir(), `hakotora-preview-${feature}-`));
const result = await build({
  stdin: {
    contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import Page from ${JSON.stringify(entry)}; import '@fortawesome/fontawesome-svg-core/styles.css'; createRoot(document.getElementById('root')).render(<React.StrictMode><Page /></React.StrictMode>);`,
    resolveDir: path.join(root, "apps/web"), loader: "tsx", sourcefile: "preview-entry.tsx",
  },
  bundle: true, outfile: path.join(output, "app.js"), platform: "browser", format: "esm",
  jsx: "automatic", alias: { "@": source, "@repo/core": path.join(root, "packages/core/src") },
  // 本番ページが読む公開設定は空文字で固定する（会社設定は DEFAULT 扱い）。環境ファイルは読まない。
  define: { "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_MAPBOX_TOKEN": JSON.stringify(publicMapboxToken), "process.env.NEXT_PUBLIC_PREVIEW_MAPBOX_ENABLED": JSON.stringify(String(mapboxEnabled)), "process.env.NEXT_PUBLIC_COMPANY_CODE": '""' }, minify: true, metafile: true,
  // 未定義の process.env.* が残っても ReferenceError で真っ白にならないよう、空の process を置く
  banner: { js: "var process = globalThis.process ?? { env: {} };" },
  plugins: [{ name: "mock-only", setup(builder) {
    if (feature === "shifts") {
      const replaced = new Set(["@/lib/api", "@/lib/useApi", "@/lib/capabilities", "@/lib/realtime/cellCursors", "@/lib/swr", "swr", "@/lib/components/AdminLayout", "@/server/shiftRequests/diff"]);
      builder.onResolve({ filter: /.*/ }, args => replaced.has(args.path) ? { path: path.join(root, "scripts/previews/shifts-services.tsx") } : undefined);
    }
    if (isAdminRunner) {
      builder.onResolve({ filter: /.*/ }, args => adminReplacements.get(args.path) ? { path: adminReplacements.get(args.path) } : undefined);
    }
    builder.onResolve({ filter: /^(?:@\/server(?:\/|$)|@\/lib\/api|@supabase\/|server-only$|@\/lib\/auth|@repo\/core\/(?:api|auth))/ }, args => ({ errors: [{ text: `Preview must not import live services: ${args.path}` }] }));
  } }],
});
if (productionPageEntries.has(feature)) {
  // admin runner は本物の @/lib/swr・@/lib/useApi を通す（内側の swr / @/lib/api が差し替え済み）。
  const livePattern = isAdminRunner
    ? /apps\/web\/src\/(?:server\/|lib\/(?:api\.|auth\/|realtime\/))|node_modules\/(?:swr|next)\/(?!dist\/compiled\/)/
    : /apps\/web\/src\/(?:server\/|lib\/(?:api\.|auth\/|swr\.|useApi\.|realtime\/))/;
  const liveImports = Object.keys(result.metafile.inputs).filter(input => livePattern.test(input));
  if (liveImports.length) throw new Error(`Live service was bundled into the ${feature} preview: ${liveImports.join(", ")}`);
}
const config = loadConfig(path.join(root, "apps/web/tailwind.config.ts"));
const css = await postcss([tailwind({ ...config, content: [path.join(source, "**/*.{ts,tsx}")] })])
  .process(await readFile(path.join(source, "app/globals.css"), "utf8"), { from: undefined });
await writeFile(path.join(output, "style.css"), css.css);
await writeFile(path.join(output, "index.html"), `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>ハコ虎｜管理プレビュー</title><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>`);
// 実画面のロゴ・ナンバー描画に必要な公開アセットだけを固定リストで同梱する。
// public全体やリポジトリを配信せず、シンボリックリンクも辿らない。
const publicRoot = path.join(root, "apps/web/public");
const assets = ["logo/hakotora-logo_primary_logo.svg", "logo/hakotora-logo_secondary_logo.svg", "fonts/TrmFontJB.ttf"];
if (feature === "shifts") assets.push("fonts/SawarabiGothic-Regular.ttf");
if (feature === "map-operations" || isAdminRunner) {
  assets.push(
    "models/acty-hh5-blockout-70-tinted.glb",
    "models/acty-hh5-blockout-70-fixed.glb",
    "models/acty-hh5-plate-acty-1201.glb",
    "models/acty-hh5-plate-acty-2752.glb",
    "models/acty-hh5-plate-acty-4303.glb",
    "models/acty-hh5-plate-acty-5854.glb",
  );
}
for (const category of ["kanji", "hiragana", "classification_numbers", "serial_numbers"]) {
  const folder = `number_plate/${category}`;
  for (const entry of await readdir(path.join(publicRoot, folder), { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".svg")) assets.push(`${folder}/${entry.name}`);
  }
}
for (const asset of assets) {
  await mkdir(path.dirname(path.join(output, asset)), { recursive: true });
  await copyFile(path.join(publicRoot, asset), path.join(output, asset));
}
console.log(`Built ${feature} (${Object.keys(result.metafile.inputs).length} modules): ${output}`);
if (mapboxEnabled) console.log("Mapbox mode: map and address requests enabled; app APIs and notifications remain isolated.");
if (!args.includes("--build")) {
  const allowed = new Map([["/", "index.html"], [`/preview/${feature}`, "index.html"], ["/app.js", "app.js"], ["/app.css", "app.css"], ["/style.css", "style.css"]]);
  for (const asset of assets) allowed.set("/" + asset.split("/").map(encodeURIComponent).join("/"), asset);
  const server = createServer(async (req, res) => {
    const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    // admin runner はページごとのURL（/preview/admin/<slug>）を同じHTMLで受ける。クエリは無視する
    const target = allowed.get(pathname) ?? (isAdminRunner && /^\/preview\/admin(?:\/[a-z0-9-]+)?$/.test(pathname) ? "index.html" : undefined);
    if (!target || !["GET", "HEAD"].includes(req.method ?? "")) { res.writeHead(404); res.end("Not found"); return; }
    try {
      const body = await readFile(path.join(output, target));
      res.writeHead(200, {
        "Content-Type": target.endsWith(".js") ? "text/javascript; charset=utf-8" : target.endsWith(".css") ? "text/css; charset=utf-8" : target.endsWith(".svg") ? "image/svg+xml" : target.endsWith(".ttf") ? "font/ttf" : target.endsWith(".glb") ? "model/gltf-binary" : "text/html; charset=utf-8",
        "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": `default-src 'self'; connect-src ${mapboxEnabled ? "'self' https://api.mapbox.com/v4/ https://api.mapbox.com/raster/v1/ https://api.mapbox.com/styles/v1/mapbox/ https://api.mapbox.com/fonts/v1/mapbox/ https://api.mapbox.com/3dtiles/v1/ https://api.mapbox.com/models/v1/ https://api.mapbox.com/map-sessions/v1 https://api.mapbox.com/search/geocode/v6/forward https://events.mapbox.com/" : feature === "shifts" ? `http://127.0.0.1:${port}/fonts/SawarabiGothic-Regular.ttf` : "'none'"}; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:${mapboxEnabled ? " blob:" : ""}; ${mapboxEnabled ? "worker-src blob:; " : ""}font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
      });
      res.end(req.method === "HEAD" ? undefined : body);
    } catch { res.writeHead(404); res.end("Not found"); }
  });
  server.on("error", error => { console.error(error.message); process.exitCode = 1; });
  const entryPath = feature === "vehicles" ? "/preview/admin/vehicles" : feature === "admin" ? "/preview/admin" : `/preview/${feature}`;
  server.listen(port, "127.0.0.1", () => console.log(`Preview: http://127.0.0.1:${port}${entryPath}`));
}
