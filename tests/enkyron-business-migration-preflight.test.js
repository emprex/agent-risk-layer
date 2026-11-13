import test from 'node:test';
import assert from 'node:assert/strict';
import {auditMigrationContinuity} from '../scripts/enkyron-business-migration-preflight.mjs';

const a='a'.repeat(64), b='b'.repeat(64), c='c'.repeat(64);
const ticket={version:'114_enkyron_ticket_scope_reviews.sql',checksum:a};
const proposal={version:'114_enkyron_crm_proposal_content_versions.sql',checksum:b};
const binding={version:'115_enkyron_crm_proposal_archive_event_binding.sql',checksum:c};

test('Business migration manifest: exact recorded history is clean without writes',()=>{
  const r=auditMigrationContinuity([ticket],[ticket]);
  assert.equal(r.ready_for_no_change,true);
  assert.equal(r.applied_records,1);
  assert.deepEqual(r.missing_source,[]);
  assert.deepEqual(r.pending,[]);
  assert.deepEqual(r.shared_number,[]);
});

test('Business migration manifest: missing ticket scope review source is a release STOP',()=>{
  const r=auditMigrationContinuity([proposal,binding],[ticket]);
  assert.equal(r.ready_for_no_change,false);
  assert.deepEqual(r.missing_source,[ticket.version]);
  assert.deepEqual(r.pending,[proposal.version,binding.version]);
  assert.deepEqual(r.shared_number,[{
    number:'114',names:[proposal.version,ticket.version].sort()
  }]);
});

test('Business migration manifest: both 114 files are distinct full-file IDs',()=>{
  const r=auditMigrationContinuity([ticket,proposal,binding],[ticket]);
  assert.equal(r.ready_for_no_change,false);
  assert.deepEqual(r.missing_source,[]);
  assert.deepEqual(r.pending,[proposal.version,binding.version]);
  assert.deepEqual(r.shared_number,[{
    number:'114',names:[proposal.version,ticket.version].sort()
  }]);
});

test('Business migration manifest: checksum drift must STOP even if names match',()=>{
  const r=auditMigrationContinuity([ticket],[{...ticket,checksum:b}]);
  assert.equal(r.ready_for_no_change,false);
  assert.deepEqual(r.checksum_mismatch,[ticket.version]);
});

test('Business migration manifest: malformed/duplicate migration names and checksums fail closed',()=>{
  assert.throws(()=>auditMigrationContinuity(
    [{version:'../etc/passwd',checksum:a}],[]),/Invalid/);
  assert.throws(()=>auditMigrationContinuity([ticket,ticket],[]),/Invalid/);
  assert.throws(()=>auditMigrationContinuity([ticket],[
    {version:ticket.version,checksum:'short'}
  ]),/Invalid/);
  assert.throws(()=>auditMigrationContinuity([],[
    ticket,ticket
  ]),/Invalid/);
});
