// モバイル配布候補を選別するだけ。アップロード・署名・Git変更は行わない。
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

const root = fileURLToPath(new URL("../", import.meta.url));
const destination = process.argv[2];
if (!destination || process.argv.length !== 3) throw new Error("Usage: node scripts/prepare-mobile-release.mjs <new-output-directory>");
const output = resolve(destination);
const fromRoot = relative(root, output);
if (!fromRoot || (!fromRoot.startsWith(`..${sep}`) && fromRoot !== "..")) throw new Error("出力先は作業リポジトリの外にしてください");
const git = (...args) => execFileSync("git", args, { cwd: root, maxBuffer: 20 * 1024 * 1024 });
const list = (...args) => git(...args).toString().split("\0").filter(Boolean);
const baseCommit = git("rev-parse", "HEAD").toString().trim();
const baselinePaths = new Set(list("ls-tree", "-r", "--name-only", "-z", baseCommit));
// 共有コードの未レビュー差分を配布候補へ混ぜない。vendorは原本同期の別工程。
if (git("status", "--porcelain", "--", "packages").length) throw new Error("packagesに差分があります。共有コードの選別を先に行ってください");
const manifests = list("ls-files", "-z", "apps/*/package.json").filter(path => /^apps\/[^/]+\/package.json$/.test(path) && path !== "apps/mobile/package.json");
const mobilePackage = JSON.parse(readFileSync(resolve(root, "apps/mobile/package.json"), "utf8"));
const rootPackage = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const selectedRoot = JSON.parse(git("show", `${baseCommit}:package.json`).toString());
// Expo Goとnative/Babelの版を揃える3項目だけ採用し、他作業のroot変更は混ぜない。
for (const name of ["react-native", "react-native-reanimated", "react-native-worklets"]) {
  const version = mobilePackage.dependencies[name];
  if (rootPackage.overrides[name] !== version) throw new Error(`${name}のoverrideとmobile依存が一致しません`);
  selectedRoot.overrides[name] = version;
}
for (const path of manifests) {
  const baseline = JSON.parse(git("show", `${baseCommit}:${path}`).toString());
  if (path === "apps/base/package.json") baseline.dependencies["react-native"] = mobilePackage.dependencies["react-native"];
  if (!isDeepStrictEqual(baseline, JSON.parse(readFileSync(resolve(root, path), "utf8")))) {
    throw new Error(`他アプリのpackage.jsonに未選別の差分があります: ${path}`);
  }
}
const excluded = [];
const candidates = list("ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "apps/mobile", "packages");
const files = [...new Set([
  ".gitignore", "package.json", "package-lock.json", ...manifests,
  "scripts/check-mobile-release.mjs",
  "scripts/start-mobile-ui.mjs",
  ...candidates.filter(path => {
    const omit = path.split("/").some(part => part.startsWith(".env") || ["node_modules", "ios", "android", "dist", ".expo"].includes(part)) ||
      /\.(?:jks|keystore|p8|p12|pem|key|mobileprovision|log|tsbuildinfo)$/.test(path) || /(?:^|\/)credentials\.json$/.test(path);
    if (omit) excluded.push(path);
    return !omit;
  }),
])].sort();
const entries = files.map(path => {
  // 親ディレクトリのsymlinkも含め、元リポジトリ外をコピーしない。
  let current = root;
  for (const part of path.split("/")) {
    current = resolve(current, part);
    if (lstatSync(current).isSymbolicLink()) throw new Error(`Symlinkは配布対象にできません: ${path}`);
  }
  const content = path === "package.json" ? Buffer.from(JSON.stringify(selectedRoot, null, 2) + "\n") : readFileSync(resolve(root, path));
  const previous = baselinePaths.has(path) ? git("show", `${baseCommit}:${path}`) : undefined;
  return { path, content, sha256: createHash("sha256").update(content).digest("hex"),
    source: path === "package.json" ? "HEAD + mobile native overrides" : "working-tree",
    changedFromBase: !previous || !previous.equals(content) };
});
// 既存ディレクトリは上書きしない。
mkdirSync(output);
const source = resolve(output, "source");
for (const entry of entries) {
  const target = resolve(source, entry.path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, entry.content, { flag: "wx" });
}
const manifest = { baseCommit, createdAt: new Date().toISOString(), source,
  excluded, files: entries.map(({ content, ...entry }) => ({ ...entry, bytes: content.length })) };
writeFileSync(resolve(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify({ source, baseCommit, files: entries.length,
  bytes: entries.reduce((sum, entry) => sum + entry.content.length, 0),
  selectedChanges: entries.filter(entry => entry.changedFromBase).map(entry => entry.path),
  manifest: resolve(output, "manifest.json") }, null, 2));
