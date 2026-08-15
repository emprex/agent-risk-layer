import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('only the platform superuser can preview the paid remediation journey without bypassing billing', () => {
  const html = read('public/result.html');
  const js = read('public/owner-customer-journey-preview.js');

  assert.match(html, /owner-customer-journey-preview\.js/);
  assert.match(js, /api\('\/api\/auth\/me'\)/);
  assert.match(js, /!auth\.user\?\.isSuperuser/);
  assert.match(js, /assessment\?\.paidTier !== 'free'/);
  assert.match(js, /assessmentRemediationHref\(\{ assessmentId: assessment\.id, isOwner: true \}\)/);
  assert.match(js, /does not grant the paid report, subscription or runtime entitlements/);
  assert.match(js, /Preview paid remediation journey/);
  assert.doesNotMatch(js, /payload\.isOwner/);
  assert.doesNotMatch(js, /paidTier\s*=/);
  assert.doesNotMatch(js, /method:\s*['"]POST['"]/);
});
