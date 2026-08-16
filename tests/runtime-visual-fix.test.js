import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('runtime evidence visual fix is loaded by the control-plane page', () => {
  const html = fs.readFileSync(new URL('../public/control-plane.html', import.meta.url), 'utf8');
  assert.match(html, /runtime-visual-fix\.css\?v=20260816\.1/);
});

test('inventory metrics collapse to a readable single column in specialist view', () => {
  const css = fs.readFileSync(new URL('../public/runtime-visual-fix.css', import.meta.url), 'utf8');
  assert.match(css, /#inventory \.inventory-metrics\s*\{[\s\S]*grid-template-columns:\s*1fr\s*!important/);
  assert.match(css, /#inventory \.inventory-metrics > div\s*\{[\s\S]*grid-template-columns:\s*minmax\(52px, auto\) minmax\(0, 1fr\)/);
});

test('technical decision evidence keeps a readable minimum table width', () => {
  const css = fs.readFileSync(new URL('../public/runtime-visual-fix.css', import.meta.url), 'utf8');
  assert.match(css, /#decisionEvidence\s*\{[\s\S]*overflow-x:\s*auto\s*!important/);
  assert.match(css, /#decisionEvidence \.data-table\s*\{[\s\S]*min-width:\s*720px/);
});
