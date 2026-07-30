#!/usr/bin/env node

// The first lookup key is retained to reuse the existing live Stripe Price safely.
// Changing a lookup key would create a parallel billing object and could split fulfilment history.
const PRICE_SPECS = [
  { envKey: 'STRIPE_PRICE_PRO_REPORT', lookupKey: 'agentrisklayer_founding_assessment_gbp_99_v900', name: 'AI Agent Security Assessment', amount: 9900, description: 'One-off AgentRiskLayer AI agent security assessment.' },
  { envKey: 'STRIPE_PRICE_DEVELOPER_MONTHLY', lookupKey: 'agentrisklayer_developer_gbp_29_monthly_v900', name: 'Developer', amount: 2900, recurring: true, description: 'Monthly AgentRiskLayer Developer plan.' },
  { envKey: 'STRIPE_PRICE_TEAM_MONTHLY', lookupKey: 'agentrisklayer_team_gbp_99_monthly_v900', name: 'Team', amount: 9900, recurring: true, description: 'Monthly AgentRiskLayer Team plan.' },
  { envKey: 'STRIPE_PRICE_AGENCY_MONTHLY', lookupKey: 'agentrisklayer_agency_gbp_249_monthly_v900', name: 'Agency', amount: 24900, recurring: true, description: 'Monthly AgentRiskLayer Agency plan.' },
];

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const deploy = args.has('--deploy');

if (args.has('--help') || args.has('-h')) {
  console.log(`Usage:
  node scripts/update-stripe-render-prices.mjs
  node scripts/update-stripe-render-prices.mjs --apply
  node scripts/update-stripe-render-prices.mjs --apply --deploy

Without --apply the script performs a dry run and changes nothing.

Required for --apply:
  STRIPE_SECRET_KEY   Stripe restricted or secret key
  RENDER_API_KEY      Render API key
  RENDER_SERVICE_ID   Render web service ID (starts with srv-)
`);
  process.exit(0);
}

function requireSecret(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required with --apply.`);
  return value;
}

async function checkedFetch(url, options, label) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { message: text };
  }
  if (!response.ok) {
    const message = body?.error?.message || body?.message || `HTTP ${response.status}`;
    throw new Error(`${label} failed: ${message}`);
  }
  return body;
}

async function stripeRequest(path, options = {}) {
  return checkedFetch(`https://api.stripe.com/v1${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${stripeKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      ...options.headers,
    },
  }, 'Stripe request');
}

async function findOrCreatePrice(spec) {
  const query = new URLSearchParams({ 'lookup_keys[]': spec.lookupKey, active: 'true', limit: '1' });
  const existing = await stripeRequest(`/prices?${query}`);
  const found = existing.data?.[0];
  if (found) {
    const correct = found.currency === 'gbp'
      && found.unit_amount === spec.amount
      && Boolean(found.recurring) === Boolean(spec.recurring);
    if (!correct) {
      throw new Error(`Stripe lookup key ${spec.lookupKey} exists with different billing terms.`);
    }
    console.log(`Reusing ${spec.envKey}: ${found.id}`);
    return found.id;
  }

  const form = new URLSearchParams({
    currency: 'gbp',
    unit_amount: String(spec.amount),
    lookup_key: spec.lookupKey,
    tax_behavior: 'inclusive',
    nickname: `${spec.name} — AgentRiskLayer v9.1`,
    'product_data[name]': spec.name,
    'product_data[metadata][app]': 'AgentRiskLayer',
    'metadata[release]': '9.1.0',
  });
  if (spec.recurring) {
    form.set('recurring[interval]', 'month');
    form.set('recurring[usage_type]', 'licensed');
  }
  const created = await stripeRequest('/prices', { method: 'POST', body: form });
  console.log(`Created ${spec.envKey}: ${created.id}`);
  return created.id;
}

async function updateRenderVariable(key, value) {
  const url = `https://api.render.com/v1/services/${encodeURIComponent(renderServiceId)}/env-vars/${encodeURIComponent(key)}`;
  await checkedFetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${renderKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ value }),
  }, `Render update for ${key}`);
  console.log(`Updated Render: ${key}`);
}

async function triggerRenderDeploy() {
  const url = `https://api.render.com/v1/services/${encodeURIComponent(renderServiceId)}/deploys`;
  const result = await checkedFetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${renderKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ clearCache: 'do_not_clear' }),
  }, 'Render deploy');
  console.log(`Triggered Render deploy${result.id ? `: ${result.id}` : ''}`);
}

if (!apply) {
  console.log('DRY RUN — no Stripe or Render changes will be made.\n');
  for (const spec of PRICE_SPECS) {
    console.log(`${spec.envKey} = £${(spec.amount / 100).toFixed(2)}${spec.recurring ? '/month' : ' one-off'}`);
  }
  console.log('\nRun again with --apply after exporting the three required credentials.');
  process.exit(0);
}

const stripeKey = requireSecret('STRIPE_SECRET_KEY');
const renderKey = requireSecret('RENDER_API_KEY');
const renderServiceId = requireSecret('RENDER_SERVICE_ID');
if (!/^srv-[A-Za-z0-9-]+$/.test(renderServiceId)) {
  throw new Error('RENDER_SERVICE_ID must be a Render service ID starting with srv-.');
}

const createdPrices = {};
for (const spec of PRICE_SPECS) {
  createdPrices[spec.envKey] = await findOrCreatePrice(spec);
}
for (const [key, value] of Object.entries(createdPrices)) {
  await updateRenderVariable(key, value);
}

if (deploy) {
  await triggerRenderDeploy();
} else {
  console.log('Render variables are updated. No deploy was triggered; add --deploy to deploy automatically.');
}
console.log('Price update completed successfully.');
