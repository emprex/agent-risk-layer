import test from 'node:test';
import assert from 'node:assert/strict';
import {explainMailOperationError} from '../desktop/enkyron-mail-errors.mjs';

test('Exact Resend HTTP failures remain diagnosable without leaking provider details',()=>{
  assert.match(explainMailOperationError(new Error('Resend inbox read failed (HTTP 401)')),/HTTP 401.*full-access/);
  assert.match(explainMailOperationError(new Error('Resend inbox read failed (HTTP 403)')),/HTTP 403/);
  assert.match(explainMailOperationError(new Error('Resend inbox read failed (HTTP 404)')),/HTTP 404/);
  assert.match(explainMailOperationError(new Error('Resend inbox read failed (HTTP 422)')),/HTTP 422/);
  assert.match(explainMailOperationError(new Error('Resend inbox read failed (HTTP 429)')),/HTTP 429/);
  assert.match(explainMailOperationError(new Error('Resend inbox read failed (HTTP 502)')),/HTTP 502/);
});
test('Database read-only failure is distinguishable from provider authorization',()=>{
  assert.match(explainMailOperationError({code:'25006',message:'cannot execute INSERT in a read-only transaction'}),/read-only PostgreSQL/);
  assert.match(explainMailOperationError({code:'42P01',message:'relation name secret'}),/table or column/);
  assert.match(explainMailOperationError({code:'42501',message:'sensitive detail'}),/insufficient PostgreSQL/);
});
test('Arbitrary provider response, credentials and SQL cannot leak into the GUI',()=>{
  const secret='re_fake-secret-token';
  const text=explainMailOperationError(new Error('API key: '+secret+' SQL INSERT INTO private_history'));
  assert.equal(text.includes(secret),false);
  assert.equal(text.includes('INSERT'),false);
  assert.match(text,/Mail operation failed/);
  assert.match(explainMailOperationError(new Error('Resend connection unavailable')),/network, timeout or access-key/);
  assert.match(explainMailOperationError(new Error('Resend returned an invalid list')),/unexpected response format/);
});
