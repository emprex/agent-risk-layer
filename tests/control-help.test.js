import assert from 'node:assert/strict';
import test from 'node:test';

import {
  controlCount,
  formatControlHelp,
  formatControlLabel,
  formatControlList,
  getControlHelpRecord,
  listControlLabels,
  normalizeControlId,
} from '../src/agent/control-help.mjs';

test('control catalogue exposes all canonical controls with human-readable labels', () => {
  assert.equal(controlCount(), 108);
  const controls = listControlLabels();
  assert.equal(controls.length, 108);
  assert.equal(controls[0].id, 'ARL-KB-001');
  assert.ok(controls.every((control) => control.title && control.category));
});

test('control IDs are normalized for operator-friendly help commands', () => {
  assert.equal(normalizeControlId('arl-kb-41'), 'ARL-KB-041');
  assert.equal(normalizeControlId('ARL-KB-090'), 'ARL-KB-090');
  assert.equal(normalizeControlId('41'), null);
});

test('applicability-style labels include ID, title and status', () => {
  const label = formatControlLabel('ARL-KB-090', 'applicable');
  assert.match(label, /^ARL-KB-090 — .+ — applicable$/);

  const list = formatControlList({ statusById: { 'ARL-KB-090': 'applicable' }, query: 'Audit coverage' });
  assert.match(list, /ARL-KB-090/);
  assert.match(list, /applicable/);
});

test('help/man output explains the control and assessment expectations', () => {
  const record = getControlHelpRecord('ARL-KB-090');
  assert.equal(record.title, 'Audit coverage cannot reconstruct a decision');

  const help = formatControlHelp('ARL-KB-090');
  assert.match(help, /ARL-KB-090/);
  assert.match(help, /What this control checks:/);
  assert.match(help, /Why it matters:/);
  assert.match(help, /When it applies:/);
  assert.match(help, /How ARL tests it:/);
  assert.match(help, /Evidence expected:/);
  assert.match(help, /Pass criteria:/);
  assert.match(help, /Fail criteria:/);
  assert.match(help, /Remediation:/);
});

test('control search matches human-readable catalogue text', () => {
  const results = listControlLabels({ query: 'Audit coverage' });
  assert.ok(results.some((control) => control.id === 'ARL-KB-090'));
});
