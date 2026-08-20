import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('zero actionable findings never enter remediation project selection', () => {
  const bootstrap = read('public/control-plane-bootstrap.js');
  assert.match(bootstrap, /actionableFindings\(assessment\)\.length === 0/);
  assert.match(bootstrap, /location\.replace\(`\/result\.html\?\$\{resultParams\.toString\(\)\}#priorityRisks`\)/);
  assert.match(bootstrap, /status !== 'information-required'/);
  assert.match(bootstrap, /kind !== 'information-required'/);

  const html = read('public/control-plane.html');
  assert.match(html, /workspace-assessment-navigation\.js/);
  assert.match(html, /control-plane-bootstrap\.js/);
  assert.doesNotMatch(html, /src="\/control-plane\.js\?v=/);
});

test('current assessment navigation is distinct from starting a new assessment', () => {
  const nav = read('public/workspace-assessment-navigation.js');
  assert.match(nav, /setLinkState\(assessmentLink, 'Assessment', `\/result\.html\?\$\{resultParams\.toString\(\)\}`\)/);
  assert.match(nav, /setLinkState\(assessmentLink, 'New assessment', '\/assessment\.html'\)/);
  assert.match(nav, /sessionStorage\.setItem\('arl_selected_assessment'/);
  assert.match(nav, /if \(!link\) return/);
  assert.match(nav, /if \(link\.textContent !== text\) link\.textContent = text/);
  assert.match(nav, /if \(link\.getAttribute\('href'\) !== href\) link\.setAttribute\('href', href\)/);

  const dashboard = read('public/dashboard.html');
  const result = read('public/result.html');
  assert.match(dashboard, /workspace-assessment-navigation\.js/);
  assert.match(result, /workspace-assessment-navigation\.js/);
  assert.match(dashboard, />Assess another agent</);
});

test('Findings and Evidence preserve the exact selected assessment', () => {
  const nav = read('public/workspace-assessment-navigation.js');
  assert.match(nav, /findingsLink/);
  assert.match(nav, /evidenceLink/);
  assert.match(nav, /assessmentScopedHref\('\/control-plane\.html', context, '#remediation'\)/);
  assert.match(nav, /assessmentScopedHref\('\/inspector\.html', context\)/);
  assert.match(nav, /recoverDroppedFindingsContext/);
  assert.match(nav, /params\.get\('assessment'\) \|\| params\.get\('projectId'\)/);
  assert.match(nav, /location\.replace\(assessmentScopedHref\('\/control-plane\.html', context, '#remediation'\)\)/);

  const controlPlane = read('public/control-plane.html');
  const result = read('public/result.html');
  assert.match(controlPlane, /workspace-assessment-navigation\.js\?v=20260820\.1/);
  assert.match(result, /workspace-assessment-navigation\.js\?v=20260820\.1/);
});
