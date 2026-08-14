import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const coreWorkspacePages = [
  'public/dashboard.html',
  'public/result.html',
  'public/assessment.html',
  'public/control-plane.html',
  'public/inspector.html',
  'public/control-intelligence.html',
  'public/inspection-detail.html',
];

test('authenticated screens use the operational application visual system instead of public flagship styling', () => {
  for (const page of coreWorkspacePages) {
    const html = read(page);
    assert.match(html, /data-shell="app"/);
    assert.match(html, /\/workspace-app\.css/);
    assert.doesNotMatch(html, /\/premium-theme\.css|\/premium-media\.css|\/visual-experience\.css/);
  }
  for (const page of ['public/dashboard.html', 'public/result.html', 'public/control-intelligence.html']) {
    assert.doesNotMatch(read(page), /\/flagship\.css/);
  }
});

test('shared shell keeps public acquisition visuals out of workspace requests', () => {
  const shell = read('public/site-shell.js');
  assert.match(shell, /function workspaceRequest\(\)/);
  assert.match(shell, /PUBLIC_EXPERIENCE_STYLES/);
  assert.match(shell, /if \(workspaceRequest\(\)\)/);
  assert.match(shell, /node\.remove\(\)/);
  assert.match(shell, /\/workspace-app\.css/);
  assert.match(shell, /from'\) === 'workspace'/);
});

test('workspace navigation is one vocabulary and preserves safe navigation context', () => {
  const shell = read('public/site-shell.js');
  for (const label of ['Overview', 'Assess', 'Findings', 'Evidence', 'Runtime', 'Settings']) {
    assert.match(shell, new RegExp(`label: '${label}'`));
  }
  assert.match(shell, /arl_selected_project/);
  assert.match(shell, /arl_selected_assessment/);
  assert.match(shell, /navigation hints only/);
  assert.match(shell, /Destination APIs remain responsible/);
  assert.match(shell, /assessment=.*#remediation/);
  assert.match(shell, /inspector\.html\?assessment=/);
  assert.match(shell, /control-plane\.html\?projectId=/);
});

test('Runtime opens the customer operational home instead of forcing the specialist console', () => {
  const shell = read('public/site-shell.js');
  assert.match(shell, /key: 'runtime', label: 'Runtime', href: '\/control-plane\.html'/);
  assert.doesNotMatch(shell, /key: 'runtime', label: 'Runtime', href: '\/control-plane\.html#runtime'/);
  assert.match(shell, /normaliseLegacyRuntimeRoute/);
  assert.match(shell, /sessionStorage\.removeItem\('arl_control_plane_mode'\)/);
});

test('workspace visual hierarchy is persistent on desktop and collapses safely on mobile', () => {
  const css = read('public/workspace-app.css');
  assert.match(css, /--app-nav-width:\s*224px/);
  assert.match(css, /@media \(min-width: 961px\)/);
  assert.match(css, /padding-left: var\(--app-nav-width\)/);
  assert.match(css, /position: fixed !important/);
  assert.match(css, /flex-direction: column !important/);
  assert.match(css, /@media \(max-width: 960px\)/);
  assert.match(css, /padding-left: 0 !important/);
  assert.match(css, /grid-template-columns: 1fr !important/);
});

test('runtime customer view puts next action before journey and demotes owner-only operations', () => {
  const css = read('public/workspace-app.css');
  assert.match(css, /human-next-card \{ order: 1; \}/);
  assert.match(css, /plain-activity \{ order: 3; \}/);
  assert.match(css, /guided-progress-v10 \{ order: 5; \}/);
  assert.match(css, /owner-assessment-cases \{ order: 20; \}/);
  assert.match(css, /guided-plan-summary[\s\S]*flex-direction: column/);
});

test('Findings navigation focuses remediation instead of the whole technical console', () => {
  const css = read('public/workspace-app.css');
  assert.match(css, /data-workspace-view="remediation"/);
  for (const id of ['runtime', 'policy', 'inventory', 'audit']) {
    assert.match(css, new RegExp(`#technicalControls > #${id}`));
  }
  assert.match(css, /#remediation[\s\S]*display: block !important/);
});

test('deployment evidence keeps the trust statement but removes it from the primary visual hierarchy', () => {
  const html = read('public/control-intelligence.html');
  assert.match(html, /<h1>Can this agent deploy\?<\/h1>/);
  assert.match(html, /<details class="risk-knowledge-disclaimer workspace-trust-note">/);
  assert.match(html, /not an accredited certification or a guarantee that the system is risk-free/);
  assert.match(html, /Decision history/);
});

test('static inspection navigation no longer exposes the obsolete app vocabulary', () => {
  const html = read('public/inspection-detail.html');
  for (const label of ['Overview', 'Assess', 'Findings', 'Evidence', 'Runtime', 'Settings', 'Help']) assert.match(html, new RegExp(`>${label}<`));
  assert.doesNotMatch(html, />Check risk<|>Live protection<|>Account</);
});
