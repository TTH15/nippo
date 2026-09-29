import { createRequire } from "node:module";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "apps/web/package.json"));
const out = await mkdtemp(path.join(tmpdir(), "hakotora-native-preview-"));
const preview = path.join(root, "scripts/mobile-preview");
const args = process.argv.slice(2);
const port = args.includes("--port") ? Number(args[args.indexOf("--port") + 1]) : 3201;
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid port");
const mapboxEnabled = args.includes("--mapbox");
const publicMapboxToken = mapboxEnabled ? (() => {
  const content = require("node:fs").readFileSync(path.join(root, "apps/web/.env.local"), "utf8");
  const token = content.match(/^NEXT_PUBLIC_MAPBOX_TOKEN=(.+)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, "");
  if (!token?.startsWith("pk.")) throw new Error("Public Mapbox token not configured");
  return token;
})() : null;
let parkingMapImage;
const vehiclePhotoIndex = args.indexOf("--vehicle-photos");
const vehiclePhotoFiles = vehiclePhotoIndex < 0 ? [] : args.slice(vehiclePhotoIndex + 1, vehiclePhotoIndex + 5);
if (vehiclePhotoIndex >= 0 && vehiclePhotoFiles.length !== 4) throw new Error("--vehicle-photos requires four paths");
const vehiclePhotoData = await Promise.all(vehiclePhotoFiles.map(file => readFile(file)));
const vehiclePhotoRoutes = new Map(vehiclePhotoData.length ? [
  ["/__local_vehicle_photo/front", vehiclePhotoData[3]],
  ["/__local_vehicle_photo/right", vehiclePhotoData[2]],
  ["/__local_vehicle_photo/rear", vehiclePhotoData[1]],
  ["/__local_vehicle_photo/left", vehiclePhotoData[0]],
] : []);
const aliases = { "react-native": "native.tsx", "@expo/vector-icons": "icons.tsx", "expo-symbols": "symbols.tsx", "@repo/core/api": "services.ts", "@repo/core/auth": "services.ts", "react-native-passkey": "passkey.ts" };
const result = await require("esbuild").build({
  entryPoints: [path.join(preview, "entry.tsx")], bundle: true, outfile: path.join(out, "app.js"),
  platform: "browser", format: "esm", jsx: "automatic", loader: { ".png": "dataurl" }, metafile: true,
  define: { "process.env.NODE_ENV": '"development"', "process.env.EXPO_PUBLIC_PASSKEY_ENABLED": '"true"' },
  plugins: [{ name: "isolate-native", setup(build) {
    build.onResolve({ filter: /.*/ }, args => {
      if (args.importer.endsWith("/screens/ShiftsScreen.tsx") && /components\/(MonthPager|BottomSheet)$/.test(args.path)) return { path: path.join(preview, "ShiftNativeAdapters.tsx") };
      if (args.path === "./ReportSourceImagePicker" && args.importer.endsWith("/DailyReportForm.tsx")) return { path: path.join(preview, "ReportSourceImagePreview.tsx") };
      if (aliases[args.path]) return { path: path.join(preview, aliases[args.path]) };
      if (/^(@\/server|@supabase|expo-|@platform)/.test(args.path)) return { errors: [{ text: `Live service forbidden: ${args.path}` }] };
    });
  } }],
});
if (Object.keys(result.metafile.inputs).some(p => /packages\/(auth|api-client)\/|\/server\/|node_modules\/(expo-|react-native-passkey)/.test(p))) throw new Error("Live service bundled");
const config = require(path.join(root, "apps/mobile/tailwind.config.js"));
delete config.presets;
const css = await require("postcss")([require("tailwindcss")({ ...config, content: [path.join(root, "apps/mobile/src/**/*.{ts,tsx}"), path.join(root, "apps/mobile/ui-preview/**/*.{ts,tsx}"), path.join(preview, "**/*.tsx")] })])
  .process('@tailwind base; @tailwind components; @tailwind utilities;', { from: undefined });
const mapboxCss = await readFile(require.resolve("mapbox-gl/dist/mapbox-gl.css"), "utf8");
await writeFile(path.join(out, "style.css"), `.rn-view,.rn-button{display:flex;flex-direction:column;min-width:0}.rn-text{overflow-wrap:anywhere}html,body,#root{min-height:100%;margin:0}button:disabled{opacity:.5}\n${css.css}\n${mapboxCss}`);
await writeFile(path.join(out, "index.html"), '<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ハコ虎｜ネイティブ管理プレビュー</title><link rel="stylesheet" href="/style.css"><div id="root"></div><script type="module" src="/app.js"></script></html>');
const files = new Map([["/style.css", "style.css"], ["/app.js", "app.js"], ["/", "index.html"], ["/preview/admin/mobile", "index.html"]]);
createServer(async (req, res) => {
  const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
  if (pathname === "/__preview_map_config" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ token: publicMapboxToken }));
    return;
  }
  if (pathname === "/__preview_parking_map" && req.method === "GET" && publicMapboxToken) {
    try {
      parkingMapImage ??= (async () => {
        const url = new URL("https://api.mapbox.com/styles/v1/mapbox/light-v11/static/135.783184,35.014564,15.5/800x480@2x");
        url.searchParams.set("attribution", "false"); url.searchParams.set("logo", "false"); url.searchParams.set("access_token", publicMapboxToken);
        const response = await fetch(url);
        if (!response.ok || response.headers.get("content-type")?.split(";")[0] !== "image/png") throw new Error("Mapbox image unavailable");
        return Buffer.from(await response.arrayBuffer());
      })().catch(error => { parkingMapImage = undefined; throw error; });
      res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" });
      res.end(await parkingMapImage);
    } catch { res.writeHead(503).end(); }
    return;
  }
  if (vehiclePhotoRoutes.has(pathname) && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    res.end(vehiclePhotoRoutes.get(pathname));
    return;
  }
  const file = files.get(pathname);
  if (!file || req.method !== "GET") { res.writeHead(404).end(); return; }
  res.writeHead(200, { "Content-Type": file.endsWith("js") ? "text/javascript" : file.endsWith("css") ? "text/css" : "text/html; charset=utf-8", "Cache-Control": "no-store",
    "Content-Security-Policy": mapboxEnabled
      ? "default-src 'self'; connect-src 'self' https://api.mapbox.com https://events.mapbox.com; img-src 'self' data: https://api.mapbox.com; style-src 'self' 'unsafe-inline'; font-src 'self' data: https://api.mapbox.com; worker-src blob:; object-src 'none'; form-action 'none'; frame-ancestors 'none'"
      : "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; object-src 'none'; form-action 'none'; frame-ancestors 'none'" });
  res.end(await readFile(path.join(out, file)));
}).listen(port, "127.0.0.1", () => console.log(`Preview: http://127.0.0.1:${port}/preview/admin/mobile`));
