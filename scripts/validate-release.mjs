import { spawnSync } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const sensitiveKeys = [
  'DATABASE_URL', 'TEST_DATABASE_URL', 'DATABASE_SSL', 'DATABASE_SSL_REJECT_UNAUTHORISED',
  'DATABASE_POOL_MAX', 'DATABASE_CONNECT_TIMEOUT_MS', 'DATABASE_IDLE_TIMEOUT_MS',
  'DATABASE_STATEMENT_TIMEOUT_MS', 'DATABASE_LOCK_TIMEOUT_MS',
  'PGHOST', 'PGHOSTADDR', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE',
  'PGSERVICE', 'PGSERVICEFILE', 'PGSSLMODE', 'PGSSLROOTCERT', 'PGAPPNAME',
  'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'RESEND_API_KEY', 'RENDER_API_KEY',
];

function isolatedEnvironment(overrides = {}) {
  const env = { ...process.env };
  for (const key of sensitiveKeys) delete env[key];
  return { ...env, ...overrides };
}

function run(label, command, args, env, { requireZeroSkips = false } = {}) {
  process.stdout.write(`\n=== ${label} ===\n`);
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  process.stdout.write(output);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} failed with exit code ${result.status}`);
  if (requireZeroSkips) {
    const matches = [...output.matchAll(/(?:#|ℹ)\s*skipped\s+(\d+)/g)];
    if (!matches.length) throw new Error(`${label} did not report a skipped-test count.`);
    if (matches.some((match) => Number(match[1]) !== 0)) {
      throw new Error(`${label} reported a skipped test.`);
    }
  }
}

const clean = isolatedEnvironment();
const testEnvironment = isolatedEnvironment({ NODE_ENV: 'test' });

run('Build release assets', npm, ['run', 'build:release-assets'], clean);
run('Complete isolated test suite', npm, ['test'], testEnvironment, { requireZeroSkips: true });
run('Syntax and source checks', npm, ['run', 'check'], clean);
run('End-to-end smoke journey', npm, ['run', 'smoke'], testEnvironment);
run('Internal detection regression', npm, ['run', 'test:detection-benchmark'], testEnvironment);
run('One-thousand scenario regression', npm, ['run', 'test:scenarios'], testEnvironment);

process.stdout.write('\nRELEASE VALIDATION PASSED\n');
process.stdout.write('All ordinary tests ran without production credentials and with zero skips.\n');
