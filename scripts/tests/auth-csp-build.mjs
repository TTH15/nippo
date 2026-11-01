// ビルド済みHTMLでnonceと初期化scriptの一致を確認する。本番設定は使わない。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';

const root = process.cwd();
const require = createRequire(path.join(root, 'apps/web/package.json'));
const socket = net.createServer();
await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
const port = socket.address().port;
await new Promise(resolve => socket.close(resolve));
const server = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
  cwd: path.join(root, 'apps/web'),
  env: { ...process.env, NODE_ENV: 'production', SUPABASE_URL: 'http://127.0.0.1:9', SUPABASE_SERVICE_ROLE_KEY: 'csp-test-placeholder', JWT_SECRET: 'csp-test-placeholder' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let diagnostic = '';
server.stdout.on('data', chunk => { diagnostic = (diagnostic + chunk).slice(-4000); });
server.stderr.on('data', chunk => { diagnostic = (diagnostic + chunk).slice(-4000); });
const base = `http://127.0.0.1:${port}`;
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(`Local test server failed: ${diagnostic}`);
    try { if ((await fetch(`${base}/login`)).ok) { ready = true; break; } } catch { /* 起動待ち */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert(ready, 'local production build did not start');
  const nonces = [];
  for (const route of ['/login', '/login', '/login/recover?next=admin', '/admin/account', '/account/bank-change']) {
    const response = await fetch(base + route);
    assert.equal(response.status, 200, route);
    const csp = response.headers.get('content-security-policy') ?? '';
    const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
    assert(nonce, `missing nonce: ${route}`);
    assert(!csp.includes("'unsafe-inline'"), 'inline script must not be permitted');
    assert(csp.includes("form-action 'self'"));
    assert(response.headers.get('cache-control')?.includes('no-store'));
    const scripts = [...(await response.text()).matchAll(/<script\b([^>]*)>/gi)];
    assert(scripts.length > 0, `no framework scripts: ${route}`);
    for (const [, attributes] of scripts) assert(attributes.includes(`nonce="${nonce}"`), `framework script has no matching nonce: ${route}`);
    nonces.push(nonce);
  }
  assert.notEqual(nonces[0], nonces[1], 'nonce must change for every response');
  for (const route of ['/api/auth/recovery-request', '/api/admin/account-recovery', '/api/platform/account-recovery']) {
    assert.equal((await fetch(base + route)).status, 401, `unauthenticated access: ${route}`);
  }
  console.log('PASS: production CSP/nonces on 5 HTML responses and 3 unauthenticated API guards.');
} finally {
  if (server.exitCode === null) {
    server.kill('SIGTERM');
    await new Promise(resolve => server.once('exit', resolve));
  }
}
