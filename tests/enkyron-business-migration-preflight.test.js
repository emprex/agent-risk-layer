import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {auditMigrationContinuity,readAppliedPsaSources} from '../scripts/enkyron-business-migration-preflight.mjs';

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

test('Business preflight: pins 5432 against inherited pg_virtualenv PGPORT',()=>{
  const script=readFileSync(
    new URL('../scripts/enkyron-business-migration-preflight.mjs',import.meta.url),'utf8'
  );
  assert.ok(script.includes("host:'/var/run/postgresql',\n    port:5432,"));
  assert.ok(script.includes("database:'arl_local'"));
  assert.ok(script.includes("current_setting('port') AS server_port"));
  assert.ok(script.includes("identity?.server_port!=='5432'"));
  assert.ok(script.includes("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"));
  assert.ok(script.includes("default_transaction_read_only=on"));
  assert.ok(!script.includes('process.env.PGPORT'));
  assert.ok(!script.includes('process.env.DATABASE_URL'));
});

test('Business audit: applied PSA drafts retain exact canonical source checksums',async()=>{
  const ids=[
    '118_enkyron_psa_mission_planning.sql',
    '119_enkyron_psa_work_items.sql',
    '120_enkyron_psa_time_entries.sql',
  ];
  const source=await readAppliedPsaSources(ids.map(version=>({version})));
  assert.deepEqual(source.map(x=>x.version),ids);
  assert.ok(source.every(x=>/^[a-f0-9]{64}$/.test(x.checksum)));
  const audit=auditMigrationContinuity(source,source);
  assert.deepEqual(audit.missing_source,[]);
  assert.deepEqual(audit.checksum_mismatch,[]);
  assert.deepEqual(audit.pending,[]);
  assert.deepEqual(await readAppliedPsaSources([]),[]);
});
