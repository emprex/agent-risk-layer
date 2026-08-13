import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('flagship art direction is scoped to the requested experiences', async () => {
  const pages = await Promise.all(['index.html','demo.html','result.html','dashboard.html','control-intelligence.html'].map(name=>read(`../public/${name}`)));
  pages.forEach(page=>assert.match(page,/flagship\.css/));
  for(const name of ['pricing.html','trust.html','help.html']) assert.doesNotMatch(await read(`../public/${name}`),/flagship\.css/);
});

test('decision trace creates the three flagship narrative moments', async () => {
  const [home,demo,result,decision,css]=await Promise.all([read('../public/index.html'),read('../public/demo.html'),read('../public/result.js'),read('../public/control-intelligence.js'),read('../public/flagship.css')]);
  assert.match(home,/flagship-trace/); assert.match(home,/UNTRUSTED INPUT/);
  assert.match(demo,/demo-action-trace/); assert.match(result,/result-decision-trace/);
  assert.match(decision,/deployment-payoff/); assert.match(css,/data-demo-stage/);
});

test('flagship motion has a reduced-motion final state', async () => {
  const css=await read('../public/flagship.css');
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
  assert.match(css,/animation:none!important/);
});
