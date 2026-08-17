import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('light enterprise visual experience is loaded without changing the commercial catalogue', async () => {
  const [shell, catalogue] = await Promise.all([read('../public/site-shell.js'), read('../src/commercial-catalogue.js')]);
  assert.match(shell, /enterprise-light\.css/);
  assert.match(catalogue, /amountPence:9900/);
  assert.match(catalogue, /amountPence:2900/);
  assert.match(catalogue, /amountPence:24900/);
});

test('homepage product story is explicitly illustrative and keyboard operable', async () => {
  const [html, script] = await Promise.all([read('../public/index.html'), read('../public/visual-story.js')]);
  assert.match(html, /Illustrative product example/);
  assert.match(html, /<button[^>]+data-story-check/);
  assert.match(html, /aria-live="polite"/);
  assert.match(script, /addEventListener\('click'/);
  assert.match(script, /prefers-reduced-motion/);
});

test('homepage compresses the product into the customer mental model before specialist detail', async () => {
  const html = await read('../public/index.html');
  assert.match(html, /Assess\. Control\. Prove\./);
  assert.match(html, /Before your AI agent reaches production, know what it can do—and prove the controls worked\./);
  assert.match(html, /Declared[\s\S]*Observed[\s\S]*Finding[\s\S]*Remediation[\s\S]*Retest[\s\S]*Decision/);
  assert.doesNotMatch(html, /UNTRUSTED INPUT/);
});

test('screenshot review utility can dismiss consent without changing application consent defaults', async () => {
  const utility = await read('../scripts/capture-browser-screenshot.mjs');
  assert.match(utility, /SCREENSHOT_DISMISS_CONSENT/);
  assert.match(utility, /data-analytics-consent/);
});
