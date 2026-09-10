import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const exists = (relativePath) => fs.existsSync(path.join(root, relativePath));

test('retired Stripe and checkout runtime is absent from the server', () => {
  const server = read('server.js');
  for (const pattern of [
    /\/api\/stripe\/webhook/,
    /\/api\/checkout/,
    /\/api\/billing\/portal/,
    /\/api\/subscriptions\/demo-cancel/,
    /publicCommercialCatalogue/,
    /handleStripeWebhook/,
    /createCheckout\(/,
    /stripeRequest\(/,
    /startFulfilmentWorker/,
  ]) assert.doesNotMatch(server, pattern);
});

test('retired billing implementation modules are removed', () => {
  for (const file of [
    'src/commercial-catalogue.js',
    'src/fulfilment.js',
    'src/stripe-events.js',
    'src/stripe-webhook.js',
    'src/subscription-access.js',
    'scripts/update-stripe-render-prices.mjs',
    'public/pricing.js',
    'public/pricing-mode.js',
    'public/success.js',
  ]) assert.equal(exists(file), false, `${file} should be removed`);
});

test('production and deployment configuration contain no Stripe surface', () => {
  assert.doesNotMatch(read('src/config.js'), /STRIPE_|stripeSecret|stripePrices|BILLABLE_PLANS|commercial-catalogue/);
  assert.doesNotMatch(read('render.yaml'), /STRIPE_/);
  assert.doesNotMatch(read('.env.example'), /STRIPE_/);
  assert.doesNotMatch(read('package.json'), /prices:update|update-stripe-render-prices/);
});

test('canonical legal pages use the current service visual system and no personal street address', () => {
  for (const page of ['public/legal/terms.html', 'public/legal/privacy.html']) {
    const html = read(page);
    assert.match(html, /marketing\.css/);
    assert.match(html, /London, United Kingdom/);
    assert.doesNotMatch(html, /Stripe|billing portal/i);
    assert.doesNotMatch(html, /270 metro central heights|se1 6bx/i);
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
