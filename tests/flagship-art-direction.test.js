import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('homepage no longer depends on the cinematic flagship stylesheet', async () => {
  const home = await read('../public/index.html');
  assert.doesNotMatch(home, /flagship\.css/);
  assert.match(home, /class="enterprise-home"/);
  assert.match(home, /class="product-preview"/);
  assert.match(home, /Assess\. Control\. Prove\./);
});

test('public and authenticated shells have separate light enterprise presentation layers', async () => {
  const [shell, publicCss, workspaceCss] = await Promise.all([
    read('../public/site-shell.js'),
    read('../public/enterprise-light.css'),
    read('../public/workspace-light.css'),
  ]);
  assert.match(shell, /enterprise-light\.css/);
  assert.match(shell, /workspace-light\.css/);
  assert.match(publicCss, /--arl-brand/);
  assert.match(workspaceCss, /--app-bg:\s*#f8fafc/);
});

test('motion is functional rather than a perpetual cyber animation', async () => {
  const [story, css] = await Promise.all([read('../public/visual-story.js'), read('../public/enterprise-light.css')]);
  assert.doesNotMatch(story, /IntersectionObserver/);
  assert.match(story, /Checking…/);
  assert.match(story, /320/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /animation:\s*none\s*!important/);
});
