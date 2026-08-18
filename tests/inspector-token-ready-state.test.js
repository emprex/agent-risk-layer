import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const inspector = fs.readFileSync(new URL('../public/inspector.js', import.meta.url), 'utf8');

test('successful Inspector token creation clears busy state and exposes a ready state', () => {
  assert.match(inspector, /finally\s*\{[\s\S]*setBusy\(button,false\);[\s\S]*syncTokenButton\(\);/);
  assert.match(inspector, /ready\?'Token ready'/);
  assert.match(inspector, /'Create new token'/);
});

test('Inspector does not create a duplicate token while the current token is valid', () => {
  assert.match(inspector, /if\(!selectedId\|\|tokenIsValidForSelected\(\)\)\s*\{/);
  assert.match(inspector, /button\.disabled=ready/);
  assert.match(inspector, /Date\.parse\(activeTokenState\.expiresAt\)>Date\.now\(\)/);
});

test('Inspector preserves the generated command and expiry notice while token is ready', () => {
  assert.match(inspector, /activeTokenState=\{assessmentId:selectedId,expiresAt:item\.expiresAt,command\}/);
  assert.match(inspector, /One-time token created\. It expires/);
  assert.match(inspector, /id=\"scanCommand\"/);
  assert.match(inspector, /scheduleTokenExpiry\(\)/);
});
