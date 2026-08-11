import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [shell, theme, media, network] = await Promise.all([
  readFile(new URL('../public/site-shell.js', import.meta.url), 'utf8'),
  readFile(new URL('../public/premium-theme.css', import.meta.url), 'utf8'),
  readFile(new URL('../public/premium-media.css', import.meta.url), 'utf8'),
  readFile(new URL('../public/evidence-network.svg', import.meta.url), 'utf8'),
]);

test('shared site shell loads the premium visual system across public and app surfaces', () => {
  assert.match(shell, /\/premium-theme\.css/);
  assert.match(shell, /\/premium-media\.css/);
  assert.match(shell, /data-arl-premium-theme|arlPremiumTheme/);
  assert.match(shell, /data-arl-premium-media|arlPremiumMedia/);
});

test('premium theme preserves hidden controls, focus visibility and semantic workflow colours', () => {
  assert.match(theme, /\*\[hidden\]\{display:none!important\}/);
  assert.match(theme, /:focus-visible\{outline:2px solid var\(--brand\)/);
  assert.match(theme, /--brand:#16b8ff/);
  assert.match(theme, /--premium-text:#f4f8ff/);
  assert.match(theme, /\.ci-stage-nav li\[data-state="current"\][\s\S]*rgba\(22,184,255/,
    'current workflow state keeps the cyan active-state treatment');
  assert.match(theme, /\.ci-stage-nav li\[data-state="complete"\][^\n]*rgba\(34,197,94/,
    'completed workflow state remains green rather than inheriting the active colour');
  assert.match(theme, /\.success-box[^\n]*rgba\(34,197,94/,
    'success surfaces remain green');
  assert.match(theme, /\.error-box[^\n]*rgba\(239,68,68/,
    'error/critical surfaces remain red');
});

test('premium media is local, bounded on mobile and respectful of reduced motion', () => {
  assert.match(media, /url\('\/evidence-network\.svg'\)/);
  assert.doesNotMatch(media, /https?:\/\//, 'premium media must not depend on third-party visual assets');
  assert.match(media, /@media\(max-width:900px\)[\s\S]*\.v10-control-visual::before,\.v10-control-visual::after\{display:none\}/);
  assert.match(media, /@media\(prefers-reduced-motion:reduce\)/);
});

test('evidence network visual is a local SVG asset without scripts or remote resources', () => {
  assert.match(network, /^<svg[\s\S]*<\/svg>\s*$/);
  assert.doesNotMatch(network, /<script\b/i);
  assert.doesNotMatch(
    network,
    /<(?:image|use|script)\b[^>]*(?:href|xlink:href)=["']https?:\/\//i,
    'standard SVG namespace is allowed, but external executable/media references are not',
  );
  assert.match(network, /#16B8FF/i);
});
