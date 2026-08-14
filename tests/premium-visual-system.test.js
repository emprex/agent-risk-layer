import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [shell, tokens, publicTheme, workspaceTheme, catalogue] = await Promise.all([
  readFile(new URL('../public/site-shell.js', import.meta.url), 'utf8'),
  readFile(new URL('../public/design-tokens.css', import.meta.url), 'utf8'),
  readFile(new URL('../public/enterprise-light.css', import.meta.url), 'utf8'),
  readFile(new URL('../public/workspace-light.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/commercial-catalogue.js', import.meta.url), 'utf8'),
]);

test('shared site shell loads the light enterprise visual system instead of the legacy dark premium layer', () => {
  assert.match(shell, /\/design-tokens\.css/);
  assert.match(shell, /\/enterprise-light\.css/);
  assert.match(shell, /\/workspace-light\.css/);
  assert.doesNotMatch(shell, /\['\/premium-theme\.css',\s*'arlPremiumTheme'\]/);
  assert.doesNotMatch(shell, /\['\/premium-media\.css',\s*'arlPremiumMedia'\]/);
  assert.doesNotMatch(shell, /\['\/visual-experience\.css',\s*'arlVisualExperience'\]/);
});

test('enterprise tokens define a restrained light system with semantic status colours', () => {
  assert.match(tokens, /--arl-bg:\s*#ffffff/);
  assert.match(tokens, /--arl-surface:\s*#f8fafc/);
  assert.match(tokens, /--arl-text:\s*#0f172a/);
  assert.match(tokens, /--arl-brand:\s*#2563eb/);
  assert.match(tokens, /--arl-success:\s*#15803d/);
  assert.match(tokens, /--arl-warning:\s*#b45309/);
  assert.match(tokens, /--arl-danger:\s*#b91c1c/);
});

test('public theme is white enterprise, removes cinematic treatment and keeps accessible focus/reduced motion', () => {
  assert.match(publicTheme, /body\[data-shell="public"\][\s\S]*background:\s*var\(--arl-bg\)\s*!important/);
  assert.match(publicTheme, /background:\s*rgba\(255,\s*255,\s*255,\s*\.94\)\s*!important/);
  assert.match(publicTheme, /:focus-visible\s*\{\s*outline:\s*2px solid var\(--arl-brand\)/);
  assert.match(publicTheme, /\.flagship-trace::before[\s\S]*display:\s*none\s*!important/);
  assert.match(publicTheme, /@media \(prefers-reduced-motion: reduce\)/);
});

test('authenticated workspace uses the same light enterprise direction without changing commercial prices', () => {
  assert.match(workspaceTheme, /--app-bg:\s*#f8fafc/);
  assert.match(workspaceTheme, /--app-nav:\s*#ffffff/);
  assert.match(workspaceTheme, /--app-accent:\s*#2563eb/);
  assert.match(catalogue, /amountPence:9900/);
  assert.match(catalogue, /amountPence:2900/);
  assert.match(catalogue, /amountPence:24900/);
});
