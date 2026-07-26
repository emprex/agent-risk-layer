import test from 'node:test';
import assert from 'node:assert/strict';
import { toCef, toOcsf } from '../src/security-export.js';

test('exports portable CEF and OCSF security events', () => {
  const event={schema:'arl.content.event.v1',requestId:'r1',timestamp:new Date().toISOString(),decision:'deny',findings:[{severity:'critical'}]};
  assert.match(toCef(event), /^CEF:0\|AgentRiskLayer\|Runtime\|6\.0\.0\|/);
  assert.equal(toOcsf(event).severity_id, 10);
  assert.equal(toOcsf(event).status, 'New');
});
