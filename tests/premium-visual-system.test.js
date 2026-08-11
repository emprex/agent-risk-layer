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

test('premium theme preserves hidden controls, focus visibility and semantic status colours', () => {
  assert.match(theme, /\*\[hidden\]\{display:none!important\}/);
  assert.match(theme, /:focus-visible\{outline:2px solid var\(--brand\)/);
  assert.match(theme, /--brand:#16b8ff/);
  assert.match(theme, /--premium-text:#f4f8ff/);
  assert.match(theme, /#22c55e/i, 'success green remains available for completed/safe state');
  assert.match(theme, /#f59e0b/i, 'warning amber remains available for hold/warning state');
  assert.match(theme, /#ef4444/i, 'critical red remains available for blocker/failure state');
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
  assert.doesNotMatch(network, /https?:\/\//i);
  assert.match(network, /#16B8FF/i);
});
