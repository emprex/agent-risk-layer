import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePublicHttpsUrl, validateOutboundHttpsUrl } from '../src/outbound-http.js';

test('outbound webhook validation rejects non-HTTPS, credentials and local destinations', () => {
  assert.throws(() => validateOutboundHttpsUrl('http://hooks.example.com/security'), /HTTPS/i);
  assert.throws(() => validateOutboundHttpsUrl('https://user:password@hooks.example.com/security'), /embedded credentials/i);
  assert.throws(() => validateOutboundHttpsUrl('https://localhost/security'), /public Internet hostname/i);
  assert.throws(() => validateOutboundHttpsUrl('https://127.0.0.1/security'), /private or reserved/i);
  assert.throws(() => validateOutboundHttpsUrl('https://10.20.30.40/security'), /private or reserved/i);
  assert.throws(() => validateOutboundHttpsUrl('https://[::1]/security'), /private or reserved/i);
});

test('outbound webhook validation preserves public HTTPS endpoints including explicit ports', () => {
  const url = validateOutboundHttpsUrl('https://hooks.example.com:8443/security');
  assert.equal(url.protocol, 'https:');
  assert.equal(url.port, '8443');
});

test('DNS resolution rejects private and mixed public/private answers', async () => {
  await assert.rejects(
    resolvePublicHttpsUrl('https://hooks.example.com/security', async () => [{ address: '10.0.0.7', family: 4 }]),
    /private or reserved/i,
  );
  await assert.rejects(
    resolvePublicHttpsUrl('https://hooks.example.com/security', async () => [
      { address: '8.8.8.8', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]),
    /private or reserved/i,
  );
});

test('DNS resolution returns one pinned public address only after all answers are public', async () => {
  const resolved = await resolvePublicHttpsUrl('https://hooks.example.com/security', async () => [
    { address: '8.8.8.8', family: 4 },
    { address: '1.1.1.1', family: 4 },
  ]);
  assert.equal(resolved.address, '8.8.8.8');
  assert.equal(resolved.family, 4);
  assert.equal(resolved.url.hostname, 'hooks.example.com');
});
