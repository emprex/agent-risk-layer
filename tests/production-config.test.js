import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');

function runConfig(env, expression) {
  return spawnSync(process.execPath, ['--input-type=module', '-e', `import('./src/config.js').then(m => ${expression})`], {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 5000,
  });
}

test('production configuration fails closed before deployment when mandatory controls are absent', () => {
  const result = runConfig({
    NODE_ENV: 'production',
    BASE_URL: 'http://insecure.example',
    DEMO_MODE: 'true',
    SESSION_SECRET: 'development-only-change-this-secret-before-deployment-123456',
    DATABASE_URL: 'postgresql://arl:secret@managed-db.internal/agentrisklayer',
  }, `m.assertSafeProductionConfig()`);
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /Unsafe production configuration/);
});

test('launch readiness passes when all required production settings exist', () => {
  const result = runConfig({
    NODE_ENV: 'production',
    BASE_URL: 'https://security.example',
    DATABASE_URL: 'postgresql://arl:secret@managed-db.internal/agentrisklayer',
    DEMO_MODE: 'false',
    SESSION_SECRET: 'a-secure-production-secret-that-is-long-enough-123',
    STRIPE_SECRET_KEY: 'sk_test_placeholder',
    STRIPE_WEBHOOK_SECRET: 'whsec_placeholder',
    STRIPE_PRICE_PRO_REPORT: 'price_pro',
    STRIPE_PRICE_DEVELOPER_MONTHLY: 'price_dev',
    STRIPE_PRICE_TEAM_MONTHLY: 'price_team',
    STRIPE_PRICE_AGENCY_MONTHLY: 'price_agency',
    RESEND_API_KEY: 're_placeholder',
    EMAIL_FROM: 'AgentRiskLayer <reports@security.example>',
    ADMIN_EMAIL: 'owner@security.example',
    SUPPORT_EMAIL: 'support@security.example',
    COMPANY_LEGAL_NAME: 'Security Example Ltd',
    COMPANY_ADDRESS: '1 Example Street, London',
    LEGAL_JURISDICTION: 'England and Wales',
    METRICS_TOKEN: 'metrics-token-that-is-long-enough-for-production-123',
  }, `console.log(JSON.stringify(m.launchReadiness()))`);
  assert.equal(result.status, 0, result.stderr);
  const readiness = JSON.parse(result.stdout.trim());
  assert.equal(readiness.ready, true);
});

test('production readiness rejects local or non-PostgreSQL persistence URLs', () => {
  for (const databaseUrl of ['postgresql://arl:secret@localhost/agentrisklayer', 'mysql://arl:secret@managed-db.internal/agentrisklayer', 'file:./data.sqlite']) {
    const result = runConfig({ NODE_ENV: 'production', DATABASE_URL: databaseUrl }, `console.log(JSON.stringify(m.launchReadiness().checks.find(c=>c.key==='managed_postgres')))`);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout.trim()).ok, false, databaseUrl);
  }
});
