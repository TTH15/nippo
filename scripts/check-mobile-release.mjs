// 外部通信・認証・EAS作成は行わない。配布先を確定してから実行する。
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const mobile = fileURLToPath(new URL("../apps/mobile/", import.meta.url));
const release = process.argv.includes("--release");
const ota = process.argv.includes("--ota");
const platformIndex = process.argv.indexOf("--platform");
const platform = platformIndex < 0 ? "all" : process.argv[platformIndex + 1];
if (!["all", "ios", "android"].includes(platform)) throw new Error("Invalid platform");
const profile = process.argv.includes("--production") ? "production" : "preview";
const result = spawnSync(process.execPath, ["../../node_modules/expo/bin/cli", "config", "--type", "public", "--json"], {
  cwd: mobile, env: { ...process.env, EXPO_NO_DOTENV: "1" }, encoding: "utf8",
});
if (result.status !== 0) throw new Error(result.stderr || "Expo config failed");
const config = JSON.parse(result.stdout);
const eas = JSON.parse(readFileSync(new URL("../apps/mobile/eas.json", import.meta.url), "utf8"));
const checks = [
  ["アプリ名", config.name === "ハコ虎"],
  ["bundle/package", config.ios?.bundleIdentifier === "jp.hakotora.app" && config.android?.package === "jp.hakotora.app"],
  ["Associated Domains", config.ios?.associatedDomains?.includes("webcredentials:hakotora.jp")],
  ["本番HTTPS接続先", eas.build[profile].env.EXPO_PUBLIC_API_BASE_URL === "https://hakotora.jp"],
  ["ATS任意通信なし", !config.ios?.infoPlist?.NSAppTransportSecurity?.NSAllowsArbitraryLoads],
  ["内部配布APK", eas.build.preview.distribution === "internal" && eas.build.preview.android?.buildType === "apk"],
  ["OTA project一致", !!config.extra?.eas?.projectId && config.updates?.url === `https://u.expo.dev/${config.extra.eas.projectId}`],
  ["OTAネイティブ互換性", config.runtimeVersion?.policy === "fingerprint"],
  ["OTA起動時取得・待機なし", config.updates?.enabled === true && config.updates?.checkAutomatically === "ON_LOAD" && config.updates?.fallbackToCacheTimeout === 0],
  ["OTA配布先分離", ["development", "preview", "production"].every(name => eas.build[name].channel === name && eas.build[name].environment === name)],
];
if (release || ota) checks.push(
  ["EAS project ID", config.extra?.eas?.projectId === "c874c3eb-642e-4670-8706-31e47e821d76"],
  ["EAS owner/slug", config.owner === "next-eight" && config.slug === "hakotora"],
);
// eas.jsonのenvはOTAへ自動適用されない。公開環境を読み込んだシェルで照合する。
if (ota) checks.push(
  ["OTA API環境一致", process.env.EXPO_PUBLIC_API_BASE_URL === eas.build[profile].env.EXPO_PUBLIC_API_BASE_URL],
  ["OTA Passkey環境一致", process.env.EXPO_PUBLIC_PASSKEY_ENABLED === eas.build[profile].env.EXPO_PUBLIC_PASSKEY_ENABLED],
);
if (release && platform !== "android") checks.push(["Apple Team ID", !!config.ios?.appleTeamId]);
for (const [label, ok] of checks) console.log(`${ok ? "OK" : "未設定"}: ${label}`);
console.log(`profile=${profile}; slug=${config.slug}; API=${eas.build[profile].env.EXPO_PUBLIC_API_BASE_URL}`);
console.log("署名・AASA/DAL公開・実機認証・配布許可は別途確認が必要です。");
if (checks.some(([, ok]) => !ok)) process.exitCode = 1;
