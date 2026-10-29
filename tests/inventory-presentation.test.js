import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../public/control-plane.js', import.meta.url), 'utf8');
const functions = source.slice(source.indexOf('function inventoryPresentation('), source.indexOf('function remediationRow('));
const context = vm.createContext({
  escapeHtml: (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'),
  dateTime: () => 'test date',
});
vm.runInContext(functions, context);
const complete = () => ({
  summary: { total: 1, evidenceComplete: true, internetExposureUnknown: 0, privilegeUnknown: 0 },
  assets: [{ name: 'fixture', internetExposureStatus: 'known-false', privilegeStatus: 'known-false' }],
  drift: { deploymentGate: 'clear', added: [], changed: [] },
});
const renderers = [
  ['summary', (snapshot) => context.inventorySummary(snapshot)],
  ['history', (snapshot) => context.inventoryHistory([snapshot])],
];

for (const [name, render] of renderers) {
  test(`${name}: incomplete evidence cannot display a favorable status`, () => {
    const snapshot = complete();
    snapshot.summary.evidenceComplete = false;
    snapshot.assets[0].internetExposureStatus = 'unknown';
    snapshot.assets[0].privilegeStatus = 'unknown';
    const before = JSON.stringify(snapshot);
    const html = render(snapshot);
    assert.match(html, /Inventory evidence incomplete/);
    assert.match(html, /1 internet-exposure statuses unknown/);
    assert.match(html, /1 privilege statuses unknown/);
    assert.doesNotMatch(html, /class="(?:drift-banner clear|status-dot active)"/);
    assert.equal(JSON.stringify(snapshot), before, 'rendering must not change evidence');
  });

  test(`${name}: missing, malformed and unknown gates never default to clear`, () => {
    for (const gate of [undefined, null, '', 'unexpected', '<script>unsafe</script>']) {
      const snapshot = complete();
      snapshot.drift.deploymentGate = gate;
      const html = render(snapshot);
      assert.match(html, /Exposure drift status unknown/);
      assert.doesNotMatch(html, /class="(?:drift-banner clear|status-dot active)"|<script>/);
    }
  });

  test(`${name}: confirmed drift still requires review when evidence is incomplete`, () => {
    const snapshot = complete();
    snapshot.summary.evidenceComplete = false;
    snapshot.drift.deploymentGate = 'review-required';
    const html = render(snapshot);
    assert.match(html, /Inventory evidence incomplete/);
    assert.match(html, /Exposure drift review required/);
  });

  test(`${name}: explicit clear is qualified and never a deployment approval`, () => {
    const html = render(complete());
    assert.match(html, /No confirmed risky exposure drift/);
    assert.match(html, /not deployment approval/);
    assert.doesNotMatch(html, /Inventory evidence incomplete/);
  });

  test(`${name}: missing evidence and legacy false values remain unknown`, () => {
    const snapshot = complete();
    delete snapshot.summary.evidenceComplete;
    snapshot.assets = [{ internetExposed: false, privileged: false }];
    const html = render(snapshot);
    assert.match(html, /Inventory evidence incomplete/);
    assert.match(html, /1 privilege statuses unknown/);
    assert.match(render({}), /Inventory evidence incomplete/);
  });

  test(`${name}: summary unknown counts cannot be hidden by partial assets`, () => {
    const snapshot = complete();
    snapshot.summary.internetExposureUnknown = 3;
    assert.match(render(snapshot), /3 internet-exposure statuses unknown/);
    assert.match(render(snapshot), /Inventory evidence incomplete/);
  });
}

test('asset names remain escaped in the summary', () => {
  const snapshot = complete();
  snapshot.assets[0].name = '<img src=x onerror=alert(1)>';
  const html = context.inventorySummary(snapshot);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
});

test('the page and dynamic imports select the corrected script versions', () => {
  const bootstrap = fs.readFileSync(new URL('../public/control-plane-bootstrap.js', import.meta.url), 'utf8');
  const page = fs.readFileSync(new URL('../public/control-plane.html', import.meta.url), 'utf8');
  assert.equal((bootstrap.match(/control-plane\.js\?v=20261029\.1/g) || []).length, 2);
  assert.match(page, /control-plane-bootstrap\.js\?v=20261029\.1/);
});
