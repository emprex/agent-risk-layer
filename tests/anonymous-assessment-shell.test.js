import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('anonymous assessment and result pages do not present an authenticated logout state', () => {
  const shared = read('public/shared.js');
  assert.match(shared, /function isAnonymousAssessmentJourney\(\)/);
  assert.match(shared, /location\.pathname\.endsWith\('\/assessment\.html'\)/);
  assert.match(shared, /location\.pathname\.endsWith\('\/result\.html'\)/);
  assert.match(shared, /navigation\.querySelector\('#logout'\)\?\.remove\(\)/);
  assert.match(shared, /hydrateAnonymousAssessmentNavigation\(\)/);
  assert.match(shared, /signIn\.textContent = 'Sign in'/);
});

test('anonymous result sign-in preserves the private result and claims it after authentication', () => {
  const shared = read('public/shared.js');
  assert.match(shared, /params\.set\('claimAssessmentId', assessmentId\)/);
  assert.match(shared, /params\.set\('claimToken', token\)/);
  assert.match(shared, /new URLSearchParams\(\{ next \}\)/);
});

test('assessment privacy copy reflects the supported anonymous assessment flow', () => {
  const html = read('public/assessment.html');
  assert.doesNotMatch(html, /authenticated site connection/);
  assert.match(html, /If you are not signed in, keep the private result link safe/);
  assert.match(html, /claim the assessment to your account/);
});