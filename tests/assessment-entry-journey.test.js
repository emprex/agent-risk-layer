import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('assessment entry explains scope, evidence discipline and the paid next step', () => {
  const html = read('public/assessment.html');
  assert.match(html, /Assess one AI agent/);
  assert.match(html, /access, data, actions, approvals, recovery and evidence/i);
  assert.match(html, /information gap rather than a vulnerability/i);
  assert.match(html, /free result that separates supported findings from missing information/i);
  assert.match(html, /£99 Security Assessment unlocks the full report, remediation and exact retest workflow/i);
});

test('assessment and result preserve the canonical signed-in vocabulary while using the focused journey shell', () => {
  const canonical = ['Overview', 'Assess', 'Findings', 'Evidence', 'Runtime', 'Settings', 'Help'];
  for (const page of ['public/assessment.html', 'public/result.html']) {
    const html = read(page);
    assert.match(html, /class="[^"]*assessment-journey-page[^"]*" data-shell="app"/);
    assert.match(html, /<small>AI agent security<\/small>/);
    assert.match(html, /aria-label="Workspace navigation"/);
    assert.match(html, /data-workspace-navigation="true"/);
    assert.match(html, /\/assessment-entry-journey\.css/);
    for (const label of canonical) assert.match(html, new RegExp(`>${label}<`));
    for (const key of ['overview', 'assess', 'findings', 'evidence', 'runtime', 'settings', 'help']) {
      assert.match(html, new RegExp(`data-workspace-key="${key}"`));
    }
    assert.doesNotMatch(html, /<small>Security workspace<\/small>/);
  }
});

test('focused journey styling removes the desktop workspace rail and hides premature workspace destinations', () => {
  const css = read('public/assessment-entry-journey.css');
  assert.match(css, /padding-left:\s*0 !important/);
  assert.match(css, /position:\s*sticky !important/);
  assert.match(css, /flex-direction:\s*row !important/);
  assert.match(css, /data-workspace-navigation/);
  assert.match(css, /data-workspace-key="overview"/);
  assert.match(css, /data-workspace-key="help"/);
  assert.match(css, /\[data-workspace-key\][^}]*display:\s*none !important/s);
  assert.match(css, /data-workspace-key="overview"[\s\S]*data-workspace-key="help"[\s\S]*display:\s*flex !important/);
  for (const key of ['assess', 'findings', 'evidence', 'runtime', 'settings']) {
    assert.doesNotMatch(css, new RegExp(`data-workspace-key="${key}"[^\\n]*display:\\s*flex`));
  }
});

test('focused journey keeps the existing assessment and result logic intact', () => {
  const assessment = read('public/assessment.html');
  const result = read('public/result.html');
  assert.match(assessment, /\/assessment\.js/);
  assert.match(result, /\/result\.js/);
  assert.match(result, /\/workspace-assessment-navigation\.js/);
  assert.match(assessment, /data-shell="app"/);
  assert.match(result, /data-shell="app"/);
});
