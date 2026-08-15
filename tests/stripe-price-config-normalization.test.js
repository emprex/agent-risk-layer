import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');

function readStripePrices(env) {
  const cleanEnvironment = { ...process.env };
  delete cleanEnvironment.HOST;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `import('./src/config.js').then(m => console.log(JSON.stringify(m.config.stripePrices)))`], {
    cwd: root,
    env: { ...cleanEnvironment, ...env },
    encoding: 'utf8',
    timeout: 5000,
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout.trim());
}

test('Stripe price environment values ignore accidental surrounding whitespace', () => {
  const prices = readStripePrices({
    STRIPE_PRICE_PRO_REPORT: ' price_pro_report\n',
    STRIPE_PRICE_DEVELOPER_MONTHLY: '\tprice_developer ',
    STRIPE_PRICE_TEAM_MONTHLY: 'price_team\r\n',
    STRIPE_PRICE_AGENCY_MONTHLY: '  price_agency  ',
  });

  assert.deepEqual(prices, {
    pro_report: 'price_pro_report',
    developer_monthly: 'price_developer',
    team_monthly: 'price_team',
    agency_monthly: 'price_agency',
  });
});
