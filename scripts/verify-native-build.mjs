// 新規checkoutで生成・コンパイルする検証専用。署名、ストア、EAS、本番APIへ接続しない。
import assert from 'node:assert/strict';
import { existsSync, readdirSync, mkdirSync, copyFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const [app, platform] = process.argv.slice(2);
assert(['mobile', 'base'].includes(app) && ['ios', 'android'].includes(platform), 'usage: <mobile|base> <ios|android>');
const root = fileURLToPath(new URL('../', import.meta.url));
const cwd = path.join(root, `apps/${app}`);
assert(!existsSync(path.join(cwd, platform)), 'Use a fresh checkout; existing native projects must not be overwritten');
const require = createRequire(path.join(root, 'package.json'));
const cli = path.join(path.dirname(require.resolve('expo/package.json')), 'bin/cli');
const env = { ...process.env, CI: '1', EXPO_NO_DOTENV: '1', EXPO_NO_TELEMETRY: '1', EXPO_PUBLIC_API_BASE_URL: 'https://preview.invalid', EXPO_PUBLIC_PASSKEY_ENABLED: 'true' };
function run(command, args, directory = cwd) {
  const result = spawnSync(command, args, { cwd: directory, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run(process.execPath, [cli, 'prebuild', '--platform', platform, '--no-install']);
const output = path.join(root, 'native-build-artifacts');
mkdirSync(output, { recursive: true });
if (platform === 'android') {
  run('./gradlew', [':app:assembleDebug', '--no-daemon', '--max-workers=2', '-PreactNativeArchitectures=arm64-v8a,x86_64'], path.join(cwd, 'android'));
  copyFileSync(path.join(cwd, 'android/app/build/outputs/apk/debug/app-debug.apk'), path.join(output, `${app}-debug.apk`));
} else {
  run('pod', ['install'], path.join(cwd, 'ios'));
  const files = readdirSync(path.join(cwd, 'ios'));
  const project = files.find(file => file.endsWith('.xcodeproj'));
  const workspace = files.find(file => file.endsWith('.xcworkspace'));
  assert(project && workspace, 'generated iOS project/workspace missing');
  const schemes = readdirSync(path.join(cwd, 'ios', project, 'xcshareddata/xcschemes')).filter(file => file.endsWith('.xcscheme'));
  assert.equal(schemes.length, 1, 'select the application scheme explicitly');
  const derived = path.join(root, 'native-derived-data');
  run('xcodebuild', ['-workspace', path.join(cwd, 'ios', workspace), '-scheme', path.basename(schemes[0], '.xcscheme'), '-configuration', 'Release', '-sdk', 'iphoneos', '-destination', 'generic/platform=iOS', '-derivedDataPath', derived, '-quiet', '-jobs', '2', 'CODE_SIGNING_ALLOWED=NO', 'CODE_SIGNING_REQUIRED=NO']);
  const products = path.join(derived, 'Build/Products/Release-iphoneos');
  const applications = readdirSync(products).filter(file => file.endsWith('.app'));
  assert.equal(applications.length, 1, 'generated unsigned application missing');
  run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', path.join(products, applications[0]), path.join(output, `${app}-ios-unsigned.zip`)]);
}
console.log(`PASS: ${app}/${platform} native build (test endpoint, no distribution)`);
