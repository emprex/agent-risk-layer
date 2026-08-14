import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('flagship art direction stays on public acquisition experiences, not the authenticated workspace', async () => {
  for (const name of ['index.html', 'demo.html']) assert.match(await read(`../public/${name}`), /flagship\.css/);
  for (const name of ['dashboard.html', 'result.html', 'control-intelligence.html', 'assessment.html', 'control-plane.html', 'inspector.html']) {
    const page = await read(`../public/${name}`);
    assert.doesNotMatch(page, /flagship\.css/, `${name} should use the operational workspace visual system`);
    assert.match(page, /workspace-app\.css/, `${name} should load the authenticated workspace visual system`);
  }
});

test('public flagship narrative remains intact without being required by authenticated screens', async () => {
  const [home, demo, css] = await Promise.all([read('../public/index.html'), read('../public/demo.html'), read('../public/flagship.css')]);
  assert.match(home, /flagship-trace/);
  assert.match(home, /UNTRUSTED INPUT/);
  assert.match(demo, /demo-action-trace/);
  assert.match(css, /data-demo-stage/);
});

test('flagship motion has a reduced-motion final state', async () => {
  const css=await read('../public/flagship.css');
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)/);
  assert.match(css,/animation:none!important/);
});