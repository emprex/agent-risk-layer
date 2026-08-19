import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('dashboard loads its visual repair without changing dashboard behaviour', () => {
  const html = read('public/dashboard.html');
  assert.match(html, /workspace-app\.css[^\n]*dashboard-visual-fix\.css[^\n]*analytics\.css/);
  assert.match(html, /src="\/dashboard\.js"/);
  assert.match(html, /src="\/agent-deletion\.js"/);
});

test('dashboard visual repair is scoped to the overview page', () => {
  const css = read('public/dashboard-visual-fix.css');
  assert.match(css, /Presentation only:[\s\S]*no assessment, finding, evidence, deployment, billing/);
  assert.match(css, /body\.workspace-overview-page\[data-shell="app"\]/);
  assert.doesNotMatch(css, /^body\[data-shell="app"\]\s/m);
});

test('evidence journey uses readable light rows instead of inherited dark task cards', () => {
  const css = read('public/dashboard-visual-fix.css');
  assert.match(css, /\.v10-task-list > li > a\s*\{[\s\S]*background:\s*#fff\s*!important/);
  assert.match(css, /\.v10-task-list > li > a strong\s*\{[\s\S]*color:\s*#0f172a\s*!important/);
  assert.match(css, /\.v10-task-list > li > a small\s*\{[\s\S]*color:\s*#64748b\s*!important/);
  assert.match(css, /\.v10-task-list > li::before,[\s\S]*display:\s*none\s*!important/);
});

test('dashboard supporting tools and settings keep the light workspace hierarchy', () => {
  const css = read('public/dashboard-visual-fix.css');
  assert.match(css, /\.workspace-secondary > summary\s*\{[\s\S]*color:\s*#0f172a\s*!important/);
  assert.match(css, /\.technical-tool-grid > a\s*\{[\s\S]*background:\s*#fff\s*!important/);
  assert.match(css, /#settings \.dashboard-grid\s*\{[\s\S]*align-items:\s*start\s*!important/);
  assert.match(css, /#settings \.danger-zone\s*\{[\s\S]*border-color:\s*#fecaca\s*!important/);
});
