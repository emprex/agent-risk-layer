import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const inspector = fs.readFileSync(new URL('../public/inspector.js', import.meta.url), 'utf8');

test('successful Inspector token creation clears busy state and exposes a ready state', () => {
  assert.match(inspector, /finally\s*\{[\s\S]*setBusy\(button,false\);[\s\S]*syncTokenButton\(\);/);
  assert.match(inspector, /Token active until/);
  assert.match(inspector, /'Create new token'/);
});

test('Inspector does not create a duplicate token while the current token is valid', () => {
  assert.match(inspector, /if\(!selectedId\|\|tokenIsValidForSelected\(\)\)\s*\{/);
  assert.match(inspector, /button\.disabled=ready/);
  assert.match(inspector, /const expiresAt=Date\.parse\(activeTokenState\.expiresAt\)/);
  assert.match(inspector, /Number\.isFinite\(expiresAt\)&&expiresAt>Date\.now\(\)/);
});

test('Inspector presents a valid token as completed rather than still working', () => {
  assert.match(inspector, /button\.style\.cursor=ready\?'default':''/);
  assert.match(inspector, /button\.title=ready\?'The one-time token is ready\. Run the command below before it expires\.':''/);
  assert.match(inspector, /button\.classList\.toggle\('token-ready',ready\)/);
});

test('Inspector preserves the generated command and expiry notice while token is ready', () => {
  assert.match(inspector, /activeTokenState=\{assessmentId:selectedId,expiresAt:item\.expiresAt,command\}/);
  assert.match(inspector, /One-time token created\. It expires/);
  assert.match(inspector, /id=\"scanCommand\"/);
  assert.match(inspector, /scheduleTokenExpiry\(\)/);
});
