import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { once } from 'node:events';
import { applySocialMetadata, DEFAULT_SOCIAL_IMAGE } from '../src/social-metadata.js';

const root = new URL('../', import.meta.url).pathname;
const ogKeys = ['title', 'description', 'type', 'url', 'image', 'image:secure_url', 'image:type', 'image:width', 'image:height', 'site_name'];
const twitterKeys = ['card', 'title', 'description', 'image', 'image:alt', 'site', 'creator'];
function validate(html, pathname, type = 'website', image = DEFAULT_SOCIAL_IMAGE) {
  const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1];
  assert.ok(head);
  const values = {};
  for (const [prefix, attr, keys] of [['og', 'property', ogKeys], ['twitter', 'name', twitterKeys]]) {
    for (const key of keys) {
      const matches = [...head.matchAll(new RegExp(`<meta ${attr}="${prefix}:${key}" content="([^"]+)"`, 'g'))];
      assert.equal(matches.length, 1, `${prefix}:${key} appears exactly once`);
      values[`${prefix}:${key}`] = matches[0][1];
    }
  }
  assert.equal(values['og:type'], type);
  assert.equal(values['og:url'], `https://agentrisklayer.com${pathname}`);
  assert.equal(values['twitter:card'], 'summary_large_image');
  for (const key of ['og:image', 'og:image:secure_url', 'twitter:image']) {
    assert.equal(values[key], image);
    assert.equal(new URL(values[key]).protocol, 'https:');
  }
  return values;
}

test('all static HTML pages inherit complete server metadata', () => {
  for (const file of fs.readdirSync(new URL('../public/', import.meta.url), { recursive: true }).filter(f => f.endsWith('.html'))) {
    const route = file === 'index.html' ? '/' : `/${file}`;
    const canonical = route.replace(/^\/research\.html$/, '/research').replace(/^(\/research\/.*)\.html$/, '$1');
    validate(applySocialMetadata(fs.readFileSync(new URL(`../public/${file}`, import.meta.url), 'utf8'), route), canonical, route.startsWith('/research/') ? 'article' : 'website');
  }
});

test('future article fallback, escaping, duplicate removal and explicit image override', () => {
  const source = '<head><title>Research &amp; testing</title><meta name="description" content="A &quot;quoted&quot; description"></head>';
  const html = applySocialMetadata(source, '/research/future-article?utm_source=x');
  validate(html, '/research/future-article', 'article');
  assert.match(html, /content="Research &amp; testing"/);
  assert.match(html, /A &quot;quoted&quot; description/);
  validate(applySocialMetadata(html, '/research/future-article'), '/research/future-article', 'article');
  const custom = source.replace('</head>', '<meta property="og:image" content="/custom.jpg"><meta property="og:image:width" content="1600"><meta property="og:image:height" content="900"></head>');
  const values = validate(applySocialMetadata(custom, '/'), '/', 'website', 'https://agentrisklayer.com/custom.jpg');
  assert.equal(values['og:image:type'], 'image/jpeg');
  assert.equal(values['og:image:width'], '1600');
  assert.equal(values['og:image:height'], '900');
  validate(applySocialMetadata(custom.replace('/custom.jpg', 'http://insecure.example/card.jpg'), '/'), '/');
});

test('HTTP crawler responses include metadata and a real PNG; HEAD agrees', { timeout: 30000 }, async t => {
  const probe = http.createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const db = `/tmp/arl-social-test-${process.pid}.sqlite`;
  const child = spawn(process.execPath, ['--import', './src/public-surface-preload.js', 'server.js'], {
    cwd: root, env: { ...process.env, NODE_ENV: 'test', PRODUCT_STAGE: 'development', DATABASE_URL: '', DATABASE_PATH: db, PORT: String(port), HOST: '127.0.0.1', DEMO_MODE: 'true', BASE_URL: `http://127.0.0.1:${port}` }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', data => { logs += data; });
  child.stderr.on('data', data => { logs += data; });
  t.after(async () => {
    if (child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); }
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(db + suffix, { force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  for (let n = 0; n < 200; n++) {
    if (logs.includes('server_started')) break;
    assert.equal(child.exitCode, null, logs);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.match(logs, /server_started/);
  for (const route of ['/', '/research', '/research/mcp-runtime-security-evidence-not-verdict', '/checks/mcp-server-risk-assessment']) {
    const response = await fetch(base + route, { headers: { 'User-Agent': 'Twitterbot/1.0' } });
    assert.equal(response.status, 200);
    const body = await response.text();
    validate(body, route, route.startsWith('/research/') ? 'article' : 'website');
    assert.equal(Number(response.headers.get('content-length')), Buffer.byteLength(body));
  }
  const imagePath = new URL(DEFAULT_SOCIAL_IMAGE).pathname;
  const response = await fetch(base + imagePath);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/png');
  const png = Buffer.from(await response.arrayBuffer());
  assert.deepEqual(png.subarray(0, 8), Buffer.from([137,80,78,71,13,10,26,10]));
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
  const head = await fetch(base + imagePath, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(Number(head.headers.get('content-length')), png.length);
  assert.equal((await head.arrayBuffer()).byteLength, 0);
});
