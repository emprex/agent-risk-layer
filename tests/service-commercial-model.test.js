import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('production configuration cannot enable legacy Stripe checkout', () => {
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    PRODUCT_STAGE: 'production',
    STRIPE_SECRET_KEY: 'sk_live_should_be_ignored',
    STRIPE_WEBHOOK_SECRET: 'whsec_should_be_ignored',
    STRIPE_PRICE_PRO_REPORT: 'price_should_be_ignored',
  };
  delete env.HOST;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import('./src/config.js').then(({config}) => console.log(JSON.stringify({
      secret: config.stripeSecretKey,
      webhook: config.stripeWebhookSecret,
      mode: config.billingWebhookMode,
      prices: config.stripePrices
    })))
  `], { cwd: root, env, encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim()), {
    secret: '',
    webhook: '',
    mode: 'disabled',
    prices: {},
  });
});

test('deployment configuration no longer provisions Stripe', () => {
  assert.doesNotMatch(read('render.yaml'), /STRIPE_/);
  assert.doesNotMatch(read('.env.example'), /STRIPE_/);
  assert.doesNotMatch(read('package.json'), /prices:update|update-stripe-render-prices/);
});

test('canonical legal pages use the service visual system and current commercial model', () => {
  for (const page of ['public/legal/terms.html', 'public/legal/privacy.html']) {
    const html = read(page);
    assert.match(html, /marketing\.css/);
    assert.match(html, /London, United Kingdom/);
    assert.doesNotMatch(html, /Stripe|billing portal|recurring online subscription[^<]*continues/i);
  }
});

test('core customer journey links to canonical legal pages', () => {
  for (const page of [
    'public/index.html',
    'public/ai-agent-security-assessment.html',
    'public/pricing.html',
    'public/request-assessment.html',
    'public/sample-report.html',
    'public/trust.html',
    'public/company.html',
  ]) {
    const html = read(page);
    assert.match(html, /\/legal\/privacy\.html/);
    assert.match(html, /\/legal\/terms\.html/);
  }
});
