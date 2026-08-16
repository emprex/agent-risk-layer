import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('runtime specialist view loads isolated spacing corrections after the base workspace styles', () => {
  const html = read('public/control-plane.html');
  const workspaceIndex = html.indexOf('/runtime-workspace.css?v=20260816.1');
  const spacingIndex = html.indexOf('/runtime-spacing.css?v=20260816.1');
  assert.ok(workspaceIndex >= 0, 'runtime workspace stylesheet is loaded');
  assert.ok(spacingIndex > workspaceIndex, 'spacing corrections load after runtime workspace styles');
});

test('runtime specialist spacing keeps compact hierarchy and responsive decision evidence', () => {
  const css = read('public/runtime-spacing.css');
  assert.match(css, /\.runtime-specialist-active \.control-overview\s*\{[\s\S]*grid-template-columns:\s*repeat\(4,/);
  assert.match(css, /\.runtime-specialist-active \.technical-controls-wrap\s*\{[\s\S]*gap:\s*14px/);
  assert.match(css, /\.runtime-specialist-active \.technical-controls-wrap > \*\s*\{[\s\S]*margin-block:\s*0 !important/);
  assert.match(css, /\.runtime-specialist-active \.technical-controls-wrap \.section-heading\.compact-heading\s*\{[\s\S]*margin:\s*0 0 12px !important/);
  assert.match(css, /\.runtime-specialist-active \.control-section \+ \.control-section\s*\{[\s\S]*margin-top:\s*18px !important/);
  assert.match(css, /\.runtime-specialist-active \.section-gap\s*\{[\s\S]*margin-top:\s*12px !important/);
  assert.match(css, /\.runtime-specialist-active \.data-table\s*\{[\s\S]*overflow-x:\s*auto/);
  assert.match(css, /@media \(max-width:\s*1180px\)[\s\S]*grid-template-columns:\s*repeat\(2,/);
  assert.match(css, /@media \(max-width:\s*760px\)[\s\S]*grid-template-columns:\s*1fr !important/);
});
