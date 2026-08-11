import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [shell, css, motion, home, authority, chain, remediation, enforcement] = await Promise.all([
  readFile(new URL('../public/site-shell.js', import.meta.url), 'utf8'),
  readFile(new URL('../public/website-v2.css', import.meta.url), 'utf8'),
  readFile(new URL('../public/website-v2.js', import.meta.url), 'utf8'),
  readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../public/visuals/authority-map.svg', import.meta.url), 'utf8'),
  readFile(new URL('../public/visuals/evidence-chain.svg', import.meta.url), 'utf8'),
  readFile(new URL('../public/visuals/remediation-loop.svg', import.meta.url), 'utf8'),
  readFile(new URL('../public/visuals/enforcement-boundary.svg', import.meta.url), 'utf8'),
]);

test('site shell loads Website v2 and no longer loads the intermediate premium skin', () => {
  assert.match(shell, /\/website-v2\.css/);
  assert.match(shell, /import '\.\/website-v2\.js'/);
  assert.doesNotMatch(shell, /premium-theme\.css/);
  assert.doesNotMatch(shell, /premium-media\.css/);
  assert.match(shell, /How it works/);
  assert.match(shell, /v2-resources/);
});

test('Website v2 preserves hidden controls, focus visibility and semantic state colours', () => {
  assert.match(css, /\*\[hidden\]\{display:none!important\}/);
  assert.match(css, /:focus-visible\{outline:3px solid var\(--v2-blue\)/);
  assert.match(css, /--v2-success:#20a464/);
  assert.match(css, /--v2-warning:#d78a00/);
  assert.match(css, /--v2-critical:#d94141/);
  assert.match(css, /body\[data-shell="public"\][\s\S]*background:var\(--v2-white\)/);
  assert.match(css, /body\[data-shell="app"\][\s\S]*background:#06101b/);
  assert.match(css, /ci-stage-nav li\[data-state="complete"\][\s\S]*32,164,100/);
  assert.match(css, /error-box[\s\S]*217,65,65/);
});

test('motion is local, progressive and respects reduced-motion users', () => {
  assert.doesNotMatch(motion, /https?:\/\//);
  assert.match(motion, /IntersectionObserver/);
  assert.match(motion, /prefers-reduced-motion: reduce/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)/);
  assert.match(css, /transform/);
  assert.match(css, /opacity/);
});

test('homepage implements the authority, evidence, remediation, runtime and trust story', () => {
  assert.match(home, /Know what your AI agent can actually do\./);
  assert.match(home, /data-authority-demo/);
  assert.match(home, /Declared controls/);
  assert.match(home, /Observed controls/);
  assert.match(home, /Exact retest/);
  assert.match(home, /A remediation is not evidence that the risk is fixed\./);
  assert.match(home, /The model proposes\. The enforcement layer decides\./);
  assert.match(home, /Security evidence, not security theatre\./);
  assert.match(home, /not an accredited certification or guarantee that a system is risk-free/i);
});

for (const [name, svg] of [['authority', authority], ['chain', chain], ['remediation', remediation], ['enforcement', enforcement]]) {
  test(`${name} visual is local SVG without script or remote media`, () => {
    assert.match(svg, /^<svg[\s\S]*<\/svg>\s*$/);
    assert.doesNotMatch(svg, /<script\b/i);
    assert.doesNotMatch(svg, /<(?:image|use|script)\b[^>]*(?:href|xlink:href)=["']https?:\/\//i);
  });
}
