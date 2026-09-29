import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const mobile = fileURLToPath(new URL("../apps/mobile/", import.meta.url));
const useGo = !process.argv.includes("--dev-client");
// 本番envファイルは読まず、端末の認証保存も使わない専用モード。
const child = spawn(process.execPath, ["../../node_modules/expo/bin/cli", "start", useGo ? "--go" : "--dev-client", "--lan", "--port", "8081", ...(process.argv.includes("--clear") ? ["--clear"] : []), ...(!useGo ? ["--scheme", process.env.HAKOTORA_DEV_SCHEME || "exp+nippo-mobile"] : [])], {
  cwd: mobile, stdio: "inherit", env: { ...process.env, EXPO_NO_DOTENV: "1", HAKOTORA_UI_PREVIEW: "1", EXPO_PUBLIC_API_BASE_URL: "https://preview.invalid", EXPO_PUBLIC_PASSKEY_ENABLED: "true" },
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", code => { process.exitCode = code ?? 1; });
