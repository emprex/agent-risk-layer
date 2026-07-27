import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');

test('public experience contains no invitation-only or beta language', () => {
  const files = fs.readdirSync(path.join(root, 'public')).filter((name) => /\.(?:html|js)$/.test(name));
  const source = files.map((name) => fs.readFileSync(path.join(root, 'public', name), 'utf8')).join('\n');
  assert.doesNotMatch(source, /controlled[- ]beta|founding[- ]beta|beta invitation|invite code|beta pending/i);
});

test('public brand does not expose an internal release-number badge', () => {
  const files = fs.readdirSync(path.join(root, 'public')).filter((name) => name.endsWith('.html'));
  for (const name of files) assert.doesNotMatch(fs.readFileSync(path.join(root, 'public', name), 'utf8'), /<em>9<\/em>/, name);
});

test('company and status pages provide public trust routes', () => {
  assert.match(fs.readFileSync(path.join(root, 'public', 'company.html'), 'utf8'), /Guillaume Strohecker/);
  assert.match(fs.readFileSync(path.join(root, 'public', 'status.html'), 'utf8'), /Live service status/);
  assert.match(fs.readFileSync(path.join(root, 'public', 'status.js'), 'utf8'), /api\/ready/);
});
