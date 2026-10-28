import test from 'node:test';
import assert from 'node:assert/strict';

import {
  selectStaleV2CheckDigestRefreshControls as select
} from '../src/agent/stale-v2-check-digest-refresh-controls.mjs';

const eligible = (controlId) => ({
  controlId,
  sourceType: 'arl_frozen_source_evidence_collection_v2',
  lineageStatus: 'source_test_or_check_lineage_mismatch',
  lineageMismatchReasons: ['check_digest_mismatch']
});

test('bulk stale-digest selector preserves existing 20-control limit', () => {
  const twenty = Array.from({ length: 20 }, (_, i) =>
    eligible('ARL-KB-' + String(i + 1).padStart(3, '0'))
  );
  assert.equal(select({lineageExceptions: twenty}).length, 20);
  assert.throws(() => select({
    lineageExceptions: [...twenty, eligible('ARL-KB-021')]
  }), /exceeds bounded 20-control limit/);
});

test('scoped refresh selects exactly one eligible control even if bulk is too large', () => {
  const twentyOne = Array.from({ length: 21 }, (_, i) =>
    eligible('ARL-KB-' + String(i + 1).padStart(3, '0'))
  );
  assert.deepEqual(select({lineageExceptions: twentyOne}, {
    controlId: 'ARL-KB-016'
  }), ['ARL-KB-016']);
});

test('scoped refresh refuses missing or non-digest-only source lineage', () => {
  const review = { lineageExceptions: [
    eligible('ARL-KB-016'),
    { ...eligible('ARL-KB-017'), lineageMismatchReasons: [
      'check_digest_mismatch', 'source_reference_mismatch'
    ] },
    { ...eligible('ARL-KB-018'), sourceType: 'manual_review' },
    { ...eligible('ARL-KB-019'), lineageStatus: 'target_revision_mismatch' }
  ] };
  assert.deepEqual(select(review, {controlId: 'ARL-KB-016'}), ['ARL-KB-016']);
  for (const id of ['ARL-KB-017', 'ARL-KB-018', 'ARL-KB-019', 'ARL-KB-020']) {
    assert.throws(() => select(review, {controlId: id}),
      /no eligible digest-only v2 source lineage/);
  }
  assert.deepEqual(select(review), ['ARL-KB-016']);
});

test('multiple stale rows cannot trigger duplicate control refresh', () => {
  const row = eligible('ARL-KB-016');
  assert.deepEqual(select({lineageExceptions: [row,row,row]}), ['ARL-KB-016']);
});

test('reject malformed control identity and unavailable authoritative review', () => {
  assert.throws(() => select(null), /authoritative source-lineage review/);
  assert.throws(() => select({lineageExceptions: []}, {controlId:'KB-016'}),
    /canonical ARL-KB/);
});
