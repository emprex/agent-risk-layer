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
  assert.match(nav, /link\.textContent = 'Assessment'/);
  assert.match(nav, /link\.href = `\/result\.html\?\$\{params\.toString\(\)\}`/);
  assert.match(nav, /link\.textContent = 'New assessment'/);
  assert.match(nav, /sessionStorage\.setItem\('arl_selected_assessment'/);

  const dashboard = read('public/dashboard.html');
  const result = read('public/result.html');
  assert.match(dashboard, /workspace-assessment-navigation\.js/);
  assert.match(result, /workspace-assessment-navigation\.js/);
  assert.match(dashboard, />Assess another agent</);
});
