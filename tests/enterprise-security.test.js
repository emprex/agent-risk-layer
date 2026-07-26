import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSecurityNotification, createSsoState, normaliseScimUser, signWebhookPayload, verifySsoState, verifyWebhookPayload } from '../src/enterprise-security.js';

const secret = 'enterprise-test-secret-with-32-characters-minimum';

test('SSO state is signed, expiring and safe-return bound', () => {
  const result = verifySsoState(createSsoState({ workspaceId: 'ws_123', returnTo: '//evil.test' }, secret), secret);
  assert.equal(result.valid, true); assert.equal(result.state.workspaceId, 'ws_123'); assert.equal(result.state.returnTo, '/dashboard.html');
});

test('SCIM users are normalised and deprovisioning is preserved', () => {
  const user = normaliseScimUser({ externalId: 'idp-1', userName: 'SECURITY@EXAMPLE.COM', active: false, role: 'admin' });
  assert.deepEqual({ email: user.email, active: user.active, role: user.role }, { email: 'security@example.com', active: false, role: 'admin' });
});

test('Slack and Jira notifications contain portable canonical metadata', () => {
  const event = { id: 'evt-1', workspaceId: 'ws-1', severity: 'critical', title: 'Tool exfiltration blocked', decision: 'deny', evidenceUrl: 'https://example.com/evidence/1' };
  assert.match(buildSecurityNotification(event, 'slack').text, /CRITICAL/);
  assert.match(buildSecurityNotification(event, 'jira').fields.summary, /Tool exfiltration/);
});

test('webhook signatures reject tampering and stale deliveries', () => {
  const signed = signWebhookPayload({ event: 'blocked' }, secret);
  assert.equal(verifyWebhookPayload(signed, secret).valid, true);
  assert.equal(verifyWebhookPayload({ ...signed, body: '{"event":"allowed"}' }, secret).valid, false);
  assert.equal(verifyWebhookPayload({ ...signed, timestamp: signed.timestamp - 1000 }, secret).reason, 'timestamp');
});
