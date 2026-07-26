import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const users = Number(process.argv[2] || 100);
const requestsPerUser = Number(process.argv[3] || 50);
const port = Number(process.env.STRESS_PORT || 3299);
const dbPath = path.resolve('data/load-stress.sqlite');
for (const suffix of ['', '-shm', '-wal']) fs.rmSync(dbPath + suffix, { force: true });

const child = spawn(process.execPath, ['server.js'], {
  env: {
    ...process.env,
    PORT: String(port),
    BASE_URL: `http://127.0.0.1:${port}`,
    DEMO_MODE: 'true',
    SESSION_SECRET: 'load-stress-secret-12345678901234567890',
    DATABASE_PATH: dbPath,
    NODE_ENV: 'test',
    ADMIN_EMAIL: 'owner@example.com',
    SUPPORT_EMAIL: 'support@example.com',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '';
child.stdout.on('data', (data) => { logs += data; });
child.stderr.on('data', (data) => { logs += data; });

const base = `http://127.0.0.1:${port}`;
const routes = ['/api/health', '/', '/pricing.html', '/demo.html', '/quickstart.html', '/api/csrf'];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function ready() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try { if ((await fetch(`${base}/api/health`)).ok) return; } catch {}
    await sleep(100);
  }
  throw new Error(`Server did not start\n${logs}`);
}
const percentile = (values, p) => values[Math.min(values.length - 1, Math.ceil(values.length * p) - 1)] || 0;

try {
  await ready();
  const started = performance.now();
  const results = await Promise.all(Array.from({ length: users }, async (_, user) => {
    const latencies = [];
    let errors = 0;
    const statuses = {};
    let cookie = '';
    for (let request = 0; request < requestsPerUser; request += 1) {
      const route = routes[(user + request) % routes.length];
      const before = performance.now();
      try {
        // Each virtual user represents a distinct client behind the trusted
        // reverse proxy. This measures application capacity without turning
        // the test itself into a single-IP abuse event.
        const response = await fetch(`${base}${route}`, { headers: {
          ...(cookie ? { Cookie: cookie } : {}),
          'X-Forwarded-For': `10.20.${Math.floor(user / 250)}.${(user % 250) + 1}`,
        } });
        const setCookie = response.headers.get('set-cookie');
        if (setCookie) cookie = setCookie.split(';')[0];
        await response.arrayBuffer();
        statuses[response.status] = (statuses[response.status] || 0) + 1;
        if (!response.ok) errors += 1;
      } catch {
        errors += 1;
      }
      latencies.push(performance.now() - before);
    }
    return { errors, latencies, statuses };
  }));
  const elapsedMs = performance.now() - started;
  const latencies = results.flatMap((result) => result.latencies).sort((a, b) => a - b);
  const errors = results.reduce((sum, result) => sum + result.errors, 0);
  const statusCounts = results.reduce((all, result) => {
    for (const [status, count] of Object.entries(result.statuses)) all[status] = (all[status] || 0) + count;
    return all;
  }, {});
  const total = users * requestsPerUser;
  const summary = {
    generatedAt: new Date().toISOString(),
    virtualUsers: users,
    requestsPerUser,
    totalRequests: total,
    durationSeconds: Number((elapsedMs / 1000).toFixed(2)),
    requestsPerSecond: Number((total / (elapsedMs / 1000)).toFixed(1)),
    errors,
    errorRatePercent: Number((errors * 100 / total).toFixed(3)),
    statusCounts,
    latencyMs: {
      p50: Number(percentile(latencies, 0.50).toFixed(1)),
      p95: Number(percentile(latencies, 0.95).toFixed(1)),
      p99: Number(percentile(latencies, 0.99).toFixed(1)),
      max: Number((latencies.at(-1) || 0).toFixed(1)),
    },
    scope: 'Local mixed public-read and per-user CSRF/session traffic; no real payments, emails, or external services.',
  };
  fs.mkdirSync('test-artifacts', { recursive: true });
  fs.writeFileSync(`test-artifacts/AgentRiskLayer-v9.0.0-load-stress-${users}x${requestsPerUser}.json`, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary));
  if (errors) process.exitCode = 1;
} finally {
  child.kill('SIGTERM');
}
