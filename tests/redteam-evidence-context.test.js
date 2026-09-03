import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('evidence plan opens the controlled runner with assessment, case and plan context', () => {
  const planUi = read('public/inspector-evidence-plan.js');
  assert.match(planUi, /params\.set\('case', caseId\)/);
  assert.match(planUi, /params\.set\('plan', check\.id\)/);
  assert.match(planUi, /\/redteam\.html\?/);
});

test('controlled runner loads evidence context and validates case against the selected plan', () => {
  const html = read('public/redteam.html');
  const js = read('public/redteam-evidence-context.js');

  assert.match(html, /redteam-evidence-context\.js/);
  assert.match(js, /evidencePlanCatalog/);
  assert.match(js, /plan\.caseId === requestedCase/);
  assert.match(js, /data-bounded-evidence-context/);
  assert.match(js, /Security invariant/);
  assert.match(js, /Passing it does not close the evidence question/);
});

test('bounded evidence context locks the selected case and switches to authorised adapter testing', () => {
  const js = read('public/redteam-evidence-context.js');

  assert.match(js, /caseInput\.readOnly = true/);
  assert.match(js, /adapterMode\.checked = true/);
  assert.match(js, /simulationMode\.checked = false/);
  assert.match(js, /adapterFields\.hidden = false/);
  assert.match(js, /Create bounded evidence command/);
  assert.match(js, /cannot silently broaden into the full catalogue/);
});
