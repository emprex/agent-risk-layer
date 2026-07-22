import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');

test('production server fails closed with unsafe configuration', () => {
  const databasePath = path.join(os.tmpdir(), `arl-config-${Date.now()}.sqlite`);
  const result = spawnSync(process.execPath, ['server.js'], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      BASE_URL: 'http://insecure.example',
      DEMO_MODE: 'true',
      SESSION_SECRET: 'development-only-change-this-secret-before-deployment-123456',
      DATABASE_PATH: databasePath,
    },
    encoding: 'utf8',
    timeout: 5000,
  });
  for (const suffix of ['', '-shm', '-wal']) fs.rmSync(databasePath + suffix, { force: true });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /Unsafe production configuration/);
});

test('launch readiness passes when all required production settings exist', () => {
  const script = `import('./src/config.js').then(({launchReadiness}) => console.log(JSON.stringify(launchReadiness())))`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      BASE_URL: 'https://security.example',
      DEMO_MODE: 'false',
      SESSION_SECRET: 'a-secure-production-secret-that-is-long-enough-123',
      STRIPE_SECRET_KEY: 'sk_test_placeholder',
      STRIPE_WEBHOOK_SECRET: 'whsec_placeholder',
      STRIPE_PRICE_BASIC_REPORT: 'price_basic',
      STRIPE_PRICE_PRO_REPORT: 'price_pro',
      STRIPE_PRICE_DEVELOPER_MONTHLY: 'price_dev',
      STRIPE_PRICE_AGENCY_MONTHLY: 'price_agency',
      RESEND_API_KEY: 're_placeholder',
      EMAIL_FROM: 'AgentRiskLayer <reports@security.example>',
      ADMIN_EMAIL: 'owner@security.example',
      SUPPORT_EMAIL: 'support@security.example',
      COMPANY_LEGAL_NAME: 'Security Example Ltd',
      COMPANY_ADDRESS: '1 Example Street, London',
      LEGAL_JURISDICTION: 'England and Wales',
    },
    encoding: 'utf8',
    timeout: 5000,
  });
  assert.equal(result.status, 0, result.stderr);
  const readiness = JSON.parse(result.stdout.trim());
  assert.equal(readiness.ready, true);
});
