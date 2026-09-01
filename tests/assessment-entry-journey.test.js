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

test('assessment and result start with a customer-facing header instead of workspace complexity', () => {
  for (const page of ['public/assessment.html', 'public/result.html']) {
    const html = read(page);
    assert.match(html, /class="[^"]*assessment-journey-page[^"]*" data-shell="app"/);
    assert.match(html, /aria-label="AgentRiskLayer home"/);
    assert.match(html, /<small>AI agent security<\/small>/);
    assert.match(html, /aria-label="Assessment navigation"/);
    assert.match(html, /\/assessment-entry-journey\.css/);
    assert.doesNotMatch(html, /<nav[^>]*>[^<]*(?:<a[^>]*>Overview<\/a>)/s);
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
  for (const key of ['findings', 'evidence', 'runtime', 'settings']) {
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
