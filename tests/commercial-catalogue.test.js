import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BILLABLE_PLANS, COMMERCIAL_CATALOGUE, PLAN_ENTITLEMENTS, publicCommercialCatalogue } from '../src/commercial-catalogue.js';
import { plans } from '../src/config.js';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('one authoritative catalogue fixes every approved billing fact', () => {
  const expected = {
    pro_report: ['AI Agent Security Assessment',9900,'GBP','one_off'],
    developer_monthly: ['Developer',2900,'GBP','month'],
    team_monthly: ['Team',9900,'GBP','month'],
    agency_monthly: ['Agency',24900,'GBP','month'],
    enterprise: ['Enterprise',600000,'GBP','year'],
  };
  for (const [key,[name,amount,currency,recurrence]] of Object.entries(expected)) {
    assert.equal(COMMERCIAL_CATALOGUE[key].name,name);
    assert.equal(COMMERCIAL_CATALOGUE[key].amountPence,amount);
    assert.equal(COMMERCIAL_CATALOGUE[key].currency,currency);
    assert.equal(COMMERCIAL_CATALOGUE[key].recurrence,recurrence);
  }
  assert.equal(COMMERCIAL_CATALOGUE.enterprise.minimum,true);
  assert.equal(plans,BILLABLE_PLANS);
});

test('public catalogue is a safe projection of billing and enforced entitlements', () => {
  const catalogue=publicCommercialCatalogue();
  for (const key of Object.keys(PLAN_ENTITLEMENTS)) assert.deepEqual(catalogue[key].limits,COMMERCIAL_CATALOGUE[key].limits);
  assert.deepEqual(Object.keys(catalogue).sort(),['agency_monthly','community','developer_monthly','enterprise','pro_report','team_monthly']);
  assert.equal(JSON.stringify(catalogue).includes('price_'),false);
  assert.equal(JSON.stringify(catalogue).includes('secret'),false);
});

test('pricing UI presents four decisions and nests three tiers beneath Protect', () => {
  const html=read('public/pricing.html'),js=read('public/pricing.js');
  for (const label of ['START','ASSESS','PROTECT','ENTERPRISE']) assert.match(`${html}\n${js}`,new RegExp(label));
  assert.match(js,/data-commercial-group="protect"/);
  assert.match(js,/\['developer_monthly','team_monthly','agency_monthly'\]/);
  assert.match(js,/protect-tier-grid/);
  assert.doesNotMatch(js,/const entitlements\s*=|const summaries\s*=/);
  assert.doesNotMatch(html,/Developer · £29|Team · £99|Agency · £249|Community · £0/);
});

test('homepage and help derive commercial summaries from the public catalogue', () => {
  const helper=read('public/commercial-surfaces.js');
  assert.match(read('public/index.html'),/data-commercial-preview/);
  assert.match(read('public/help.html'),/data-commercial-help/);
  assert.match(helper,/api\/config/);
  assert.match(helper,/catalogue/);
  const dashboard=read('public/dashboard.js');
  assert.match(dashboard,/subscriptionHtml\(data\.subscription, data\.controlPlane\?\.entitlement\)/);
  assert.doesNotMatch(dashboard,/Community · £0|10,000 runtime checks/);
});

test('checkout retains existing server product keys and Stripe bindings', () => {
  const config=read('src/config.js'),pricing=read('public/pricing.js');
  for (const key of ['pro_report','developer_monthly','team_monthly','agency_monthly']) {
    assert.ok(BILLABLE_PLANS[key]);
    if (key !== 'pro_report') assert.match(pricing,new RegExp(`['"]?${key}['"]?`));
  }
  for (const env of ['STRIPE_PRICE_PRO_REPORT','STRIPE_PRICE_DEVELOPER_MONTHLY','STRIPE_PRICE_TEAM_MONTHLY','STRIPE_PRICE_AGENCY_MONTHLY']) assert.match(config,new RegExp(env));
  assert.match(pricing,/productKey: button\.dataset\.checkout/);
});

test('customer-facing catalogue surfaces contain no independent monetary catalogue', () => {
  for (const path of ['public/pricing.js','public/pricing.html','public/index.html','public/help.html']) {
    const source=read(path);
    assert.doesNotMatch(source,/£249|£6,000|amountPence:\s*(?:2900|9900|24900|600000)/,path);
  }
});
