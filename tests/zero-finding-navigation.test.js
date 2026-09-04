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

test('current assessment navigation keeps Findings on the selected assessment', () => {
  const nav = read('public/workspace-assessment-navigation.js');
  assert.match(nav, /location\.pathname\.endsWith\('\/result\.html'\) \? params\.get\('id'\)/);
  assert.match(nav, /setLinkState\(assessmentLink, 'Assessment', assessmentResultHref\(context\)\)/);
  assert.match(nav, /setLinkState\(findingsLink, 'Findings', assessmentResultHref\(context, '#confirmedFindings'\)\)/);
  assert.match(nav, /sessionStorage\.setItem\('arl_selected_assessment'/);
  assert.match(nav, /setLinkState\(assessmentLink, 'New assessment', '\/assessment\.html'\)/);

  for (const page of ['public/dashboard.html', 'public/result.html', 'public/control-plane.html', 'public/inspector.html', 'public/redteam.html', 'public/inspection-detail.html']) {
    assert.match(read(page), /workspace-assessment-navigation\.js/, `${page} must preserve assessment navigation context`);
  }
  assert.match(read('public/dashboard.html'), />Assess another agent</);
});
