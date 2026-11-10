import test from 'node:test';
import assert from 'node:assert/strict';
import {explainLocalError} from '../desktop/enkyron-db-errors.mjs';
test('shows operator validation errors but never arbitrary DB details',()=>{
  assert.match(explainLocalError(new Error('ENKYRON Company UTR must contain exactly 10 digits')),/10 digits/);
  const e=new Error('Duplicate UTR secret 0123456789 and SQL INSERT...');
  e.code='23505';
  const output=explainLocalError(e);
  assert.match(output,/23505/);
  assert.doesNotMatch(output,/0123456789|INSERT|secret/);
  const missing=Object.assign(new Error('sensitive DB details'),{code:'42703'});
  assert.match(explainLocalError(missing),/42703/);
  assert.equal(explainLocalError(new Error('sensitive failure')),
    'Local PostgreSQL operation failed. Check database, permissions and migrations.');
});
