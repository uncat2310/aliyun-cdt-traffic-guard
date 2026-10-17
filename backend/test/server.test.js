import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import net from 'node:net';

// 配置在 import 时读取，所以先写临时配置再动态导入
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-server-'));
const staticDir = path.join(dir, 'dist');
fs.mkdirSync(path.join(staticDir, 'assets'), { recursive: true });
fs.writeFileSync(path.join(staticDir, 'index.html'), '<!doctype html><html><head><title>t</title></head><body></body></html>');
fs.writeFileSync(path.join(staticDir, 'assets', 'app-1.js'), `console.log(${'1'.repeat(500)});`);
fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ secret: 'TOP-SECRET' }));
fs.symlinkSync(path.join(dir, 'config.json'), path.join(staticDir, 'link.json'));
fs.writeFileSync(path.join(dir, 'cfg.json'), JSON.stringify({
  history_dir: path.join(dir, 'history'),
  servers: {
    s1: {
      name: '</script><script>alert(1)</script>', ip: '8.8.8.8', masked_ip: '8.8.*.*', instance_id: 'i-abcdefghijk',
      region_id: 'cn-hongkong', ak: 'LTAIrealkey', sk: 'realsecret', threshold_gb: 100,
    },
  },
}));
process.env.CONFIG_PATH = path.join(dir, 'cfg.json');

const { settings } = await import('../src/config.js');
const monitor = await import('../src/monitor.js');
const { createDashboardServer } = await import('../src/server.js');

const calls = { cdt: 0, ecs: 0, cbwp: 0 };
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
monitor.api.queryCdtTraffic = async () => {
  calls.cdt += 1;
  await delay(100);
  return { success: true, total_bytes: 1, total_gb: 50, isp: 'BGP', product: 'CBWP' };
};
monitor.api.queryEcsInfo = async () => {
  calls.ecs += 1;
  await delay(100);
  return { success: false, status: 'Running', public_ips: ['8.8.8.8'], error: 'SignatureDoesNotMatch LTAIrealkey' };
};
monitor.api.querySharedBandwidth = async () => {
  calls.cbwp += 1;
  return 200;
};

let server;
let base;
before(async () => {
  server = createDashboardServer({ staticDir });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

function rawRequest(target) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(server.address().port, '127.0.0.1', () => {
      socket.write(`GET ${target} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`);
    });
    let out = '';
    socket.on('data', (c) => { out += c; });
    socket.on('end', () => resolve(out));
    socket.on('error', reject);
  });
}

test('static files cannot escape dashboard_dist', async () => {
  for (const target of ['/../config.json', '/..%2fconfig.json', '/%2e%2e/config.json', '/assets/../../config.json',
    '/assets/..%2f..%2fconfig.json', '/link.json', '//etc/passwd', '/%00', '/%E0%A4%A']) {
    const out = await rawRequest(target);
    assert.ok(!out.includes('TOP-SECRET') && !out.includes('root:'), target);
  }
});

test('index inlines escaped initial data without secrets', async () => {
  const res = await fetch(`${base}/`);
  const html = await res.text();
  assert.ok(html.includes('window.__INITIAL_DATA__'));
  assert.ok(!html.includes('</script><script>alert'));
  assert.ok(html.includes('\\u003c/script\\u003e'));
  for (const secret of ['8.8.8.8', 'realsecret', 'LTAI']) assert.ok(!html.includes(secret), secret);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('access-control-allow-origin'), null);
});

test('overview api hides public ips and raw errors', async () => {
  const ov = await (await fetch(`${base}/api/overview`)).json();
  const node = ov.servers.s1;
  assert.equal(node.ecs_info.public_ips, undefined);
  assert.equal(node.ecs_info.error, 'ECS query failed');
  assert.equal(node.traffic.bandwidth_mbps, 200);
  assert.equal(node.ip, '8.8.*.*');
});

test('assets are gzipped and immutable; HEAD has no body; unknown routes get the SPA', async () => {
  const res = await fetch(`${base}/assets/app-1.js`, { headers: { 'Accept-Encoding': 'gzip' } });
  assert.match(res.headers.get('cache-control'), /immutable/);
  assert.ok((await res.text()).startsWith('console.log'));

  const raw = await new Promise((resolve) => {
    import('node:http').then(({ default: http }) => {
      http.get(`${base}/assets/app-1.js`, { headers: { 'Accept-Encoding': 'gzip' } }, (r) => {
        const chunks = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => resolve({ headers: r.headers, body: Buffer.concat(chunks) }));
      });
    });
  });
  assert.equal(raw.headers['content-encoding'], 'gzip');
  assert.ok(zlib.gunzipSync(raw.body).toString().startsWith('console.log'));

  const head = await fetch(`${base}/assets/app-1.js`, { method: 'HEAD' });
  assert.ok(Number(head.headers.get('content-length')) > 0);
  assert.equal((await head.arrayBuffer()).byteLength, 0);

  assert.ok((await (await fetch(`${base}/some/route`)).text()).includes('__INITIAL_DATA__'));
});

test('POST refresh works with a body; oversized bodies are rejected', async () => {
  const res = await fetch(`${base}/api/refresh`, { method: 'POST', body: '{"x":1}', headers: { 'Content-Type': 'application/json' } });
  assert.equal((await res.json()).success, true);
  const big = await fetch(`${base}/api/refresh`, { method: 'POST', body: 'x'.repeat(100_000) });
  assert.equal(big.status, 413);
});

test('forced refreshes are throttled and coalesced', async () => {
  const before = { ...calls };
  await Promise.all(Array.from({ length: 20 }, () => fetch(`${base}/api/overview?force=1`).then((r) => r.json())));
  assert.ok(calls.cdt - before.cdt <= 1, JSON.stringify(calls));
  assert.equal(calls.cbwp, 1);
});

test('basic auth when a password is configured', async () => {
  settings.authPassword = 's3cret';
  try {
    const denied = await fetch(`${base}/api/overview`);
    assert.equal(denied.status, 401);
    assert.match(denied.headers.get('www-authenticate'), /^Basic /);
    const wrong = await fetch(`${base}/`, { headers: { Authorization: `Basic ${Buffer.from('admin:nope').toString('base64')}` } });
    assert.equal(wrong.status, 401);
    const ok = await fetch(`${base}/api/history`, { headers: { Authorization: `Basic ${Buffer.from('admin:s3cret').toString('base64')}` } });
    assert.equal(ok.status, 200);
  } finally {
    settings.authPassword = '';
  }
});

test('guard stops over threshold and only starts confirmed-stopped instances', async () => {
  const actions = [];
  monitor.api.setInstancePower = async (cfg, action) => { actions.push(action); };
  const overview = (used, status) => ({ servers: { s1: { status, traffic: { query_ok: true, used_gb: used } } } });
  for (const [used, status] of [[150, 'Running'], [150, 'Unknown'], [150, 'Stopping'], [150, 'Stopped'],
    [10, 'Stopped'], [10, 'Unknown'], [10, 'Starting'], [10, 'Running']]) {
    await monitor.enforceGuards(overview(used, status));
  }
  assert.deepEqual(actions, ['stop', 'stop', 'start']);
  await monitor.enforceGuards({ servers: { s1: { status: 'Running', traffic: { query_ok: false, used_gb: 999 } } } });
  assert.deepEqual(actions, ['stop', 'stop', 'start']);
});
