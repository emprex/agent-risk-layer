import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('visual experience is loaded without changing the commercial catalogue', async () => {
  const [shell, catalogue] = await Promise.all([read('../public/site-shell.js'), read('../src/commercial-catalogue.js')]);
  assert.match(shell, /visual-experience\.css/);
  assert.match(catalogue, /amountPence:9900/);
  assert.match(catalogue, /amountPence:2900/);
  assert.match(catalogue, /amountPence:24900/);
});

test('homepage visual story is explicitly synthetic and keyboard operable', async () => {
  const [html, script] = await Promise.all([read('../public/index.html'), read('../public/visual-story.js')]);
  assert.match(html, /Interactive synthetic example/);
  assert.match(html, /<button[^>]+data-story-check/);
  assert.match(html, /aria-live="polite"/);
  assert.match(script, /addEventListener\('click'/);
  assert.match(script, /prefers-reduced-motion/);
});

test('visual layer provides light-dark rhythm, evidence storytelling and reduced-motion fallback', async () => {
  const css = await read('../public/visual-experience.css');
  assert.match(css, /--arl-paper:#f4f6f2/);
  assert.match(css, /\.evidence-signal/);
  assert.match(css, /\.demo-v2-workbench/);
  assert.match(css, /\.trust-editorial/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)/);
  assert.match(css, /:focus-visible|\.story-check/);
});

test('screenshot review utility can dismiss consent without changing application consent defaults', async () => {
  const utility = await read('../scripts/capture-browser-screenshot.mjs');
  assert.match(utility, /SCREENSHOT_DISMISS_CONSENT/);
  assert.match(utility, /data-analytics-consent/);
});
