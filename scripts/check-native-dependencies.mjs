// SDKの推奨版と、Web/Mobile/Baseが使うReactの実体を照合する。本番envは読まない。
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
const rootRequire = createRequire(path.join(root, 'package.json'));
for (const [name, workspaces] of [
  ['react', ['web', 'mobile', 'base']], ['react-dom', ['web']],
  ['react-native', ['mobile', 'base']], ['expo', ['mobile', 'base']],
]) {
  const expected = realpathSync(rootRequire.resolve(`${name}/package.json`));
  for (const app of workspaces) {
    const require = createRequire(path.join(root, `apps/${app}/package.json`));
    assert.equal(realpathSync(require.resolve(`${name}/package.json`)), expected, `${app}: duplicate ${name}`);
  }
  console.log(`PASS: one ${name}@${rootRequire(`${name}/package.json`).version}`);
}
const cli = path.join(path.dirname(rootRequire.resolve('expo/package.json')), 'bin/cli');
for (const app of ['mobile', 'base']) {
  execFileSync(process.execPath, [cli, 'install', '--check'], {
    cwd: path.join(root, `apps/${app}`), stdio: 'inherit',
    env: { ...process.env, CI: '1', EXPO_NO_DOTENV: '1', EXPO_OFFLINE: '1' },
  });
}
