import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('runtime evidence visual fix is loaded by the control-plane page', () => {
  const html = fs.readFileSync(new URL('../public/control-plane.html', import.meta.url), 'utf8');
  assert.match(html, /runtime-visual-fix\.css\?v=20260816\.3/);
});

test('specialist workspace constrains nested content to the available width', () => {
  const css = fs.readFileSync(new URL('../public/runtime-visual-fix.css', import.meta.url), 'utf8');
  assert.match(css, /\.control-plane-layout\.technical-mode\s*\{[\s\S]*minmax\(220px, 280px\) minmax\(0, 1fr\)/);
  assert.match(css, /\.control-plane-main,[\s\S]*min-width:\s*0\s*!important/);
  assert.match(css, /@media \(max-width: 1500px\)[\s\S]*\.runtime-grid,[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)\s*!important/);
});

test('access picture gets a full readable row and horizontal evidence text', () => {
  const css = fs.readFileSync(new URL('../public/runtime-visual-fix.css', import.meta.url), 'utf8');
  assert.match(css, /#inventory \.runtime-grid\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)\s*!important/);
  assert.match(css, /#inventory \.inventory-metrics\s*\{[\s\S]*repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /writing-mode:\s*horizontal-tb\s*!important/);
  assert.match(css, /white-space:\s*normal\s*!important/);
});

test('technical decision evidence scrolls locally instead of widening the page', () => {
  const css = fs.readFileSync(new URL('../public/runtime-visual-fix.css', import.meta.url), 'utf8');
  assert.match(css, /#decisionEvidence\s*\{[\s\S]*max-width:\s*100%\s*!important[\s\S]*overflow-x:\s*auto\s*!important/);
  assert.match(css, /#decisionEvidence \.data-table\s*\{[\s\S]*width:\s*900px\s*!important/);
});
