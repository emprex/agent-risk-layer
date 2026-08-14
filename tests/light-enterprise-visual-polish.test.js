import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [analytics, workspace, legacy, tokens] = await Promise.all([
  readFile(new URL('../public/analytics.css', import.meta.url), 'utf8'),
  readFile(new URL('../public/workspace-light.css', import.meta.url), 'utf8'),
  readFile(new URL('../public/enterprise-light-legacy.css', import.meta.url), 'utf8'),
  readFile(new URL('../public/design-tokens.css', import.meta.url), 'utf8'),
]);

test('light themes load synchronously before the legacy dark shell can flash', () => {
  assert.match(analytics, /^\/\*[\s\S]*?@import url\('\/design-tokens\.css'\);/);
  assert.match(analytics, /@import url\('\/enterprise-light\.css'\);/);
  assert.match(analytics, /@import url\('\/workspace-light\.css'\);/);
});

test('workspace agent rows and active local tabs no longer reintroduce black surfaces', () => {
  assert.match(workspace, /\.workspace-agent-row,[\s\S]*?background:\s*#fff\s*!important/);
  assert.match(workspace, /\.workspace-local-nav a\[aria-current="page"\][\s\S]*?background:\s*#eff6ff\s*!important/);
  assert.match(workspace, /\.workspace-local-nav a\[aria-current="page"\][\s\S]*?color:\s*#1d4ed8\s*!important/);
});

test('workspace form labels and placeholders keep readable contrast on white', () => {
  assert.match(workspace, /body\[data-shell="app"\] label,[\s\S]*?color:\s*#475569\s*!important/);
  assert.match(workspace, /input::placeholder,[\s\S]*?color:\s*#64748b\s*!important/);
});

test('pricing catalogue and generated subscription tiers are fully light', () => {
  assert.match(legacy, /\.commercial-step,[\s\S]*?\.protect-tier[\s\S]*?background:\s*#fff\s*!important/);
  assert.match(legacy, /\.commercial-step\.assess-step[\s\S]*?background:\s*#f8fbff\s*!important/);
  assert.match(legacy, /\.assessment-includes li[\s\S]*?background:\s*var\(--arl-brand-soft\)\s*!important/);
});

test('homepage hierarchy keeps the product preview in a normal desktop first viewport', () => {
  assert.match(tokens, /\.enterprise-hero[\s\S]*?min-height:\s*620px\s*!important/);
  assert.match(tokens, /\.enterprise-hero-copy h1[\s\S]*?font-size:\s*clamp\(46px,\s*5vw,\s*60px\)\s*!important/);
});
