import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';

const root = new URL('../', import.meta.url);
const script = readFileSync(
  new URL('../scripts/enkyron-enk08-schema-only-rehearsal.sh',import.meta.url),'utf8'
);
const expected = [
  ['migrations/114_enkyron_crm_proposal_content_versions.sql',
    'd710e9851c2762c6cdc57b5c251afa2ffa2ffda3'],
  ['migrations/115_enkyron_crm_proposal_archive_event_binding.sql',
    '0b49d23d84ece91012820f82e17455f436e06318'],
  ['migrations/117_enkyron_mail_document_dossier_links.sql',
    'ad2091e15b4529074b1b68d76fc4fd391cad3e88'],
  ['docs/enkyron/sql/118_enkyron_psa_mission_planning.sql',
    'd5bfe298b245d134b6d3f7a1e652fd9ae1270324'],
  ['docs/enkyron/sql/119_enkyron_psa_work_items.sql',
    '33689aa941d16b3bd29ae74fd9ffa0d07bfefee6'],
  ['docs/enkyron/sql/120_enkyron_psa_time_entries.sql',
    'e01f1ba4342a82b0eb180cd896af4156000c68f7'],
];

function gitBlobSha(bytes) {
  return createHash('sha1')
    .update(Buffer.from('blob ' + bytes.length + '\0')).update(bytes).digest('hex');
}

test('ENK-08 clone: only six fixed reviewed SQL files can be rehearsed',()=>{
  for (const [name,sha] of expected) {
    const bytes=readFileSync(new URL(name,root));
    assert.equal(gitBlobSha(bytes),sha,'Unreviewed SQL content: '+name);
    assert.ok(script.includes(name));
    assert.ok(script.includes(sha));
  }
  assert.match(script,/git hash-object --/);
});

test('ENK-08 clone: cannot use production port or non-virtual server for writes',()=>{
  assert.match(script,/PGPORT > 5432/);
  assert.match(script,/PG_CLUSTER_CONF_ROOT/);
  assert.match(script,/\.by_pg_virtualenv/);
  assert.match(script,/SHOW config_file/);
  assert.match(script,/SHOW data_directory/);
  assert.match(script,/SHOW port/);
  assert.match(script,/createdb -h localhost -p/);
  assert.match(script,/psql_temp/);
  assert.doesNotMatch(script,/runMigrations\s*\(/);
  assert.doesNotMatch(script,/psql.*-d arl_local.*-f/);
});

test('ENK-08 clone: production PostgreSQL reads schema only',()=>{
  assert.match(script,/default_transaction_read_only=on/);
  assert.match(script,/--schema-only/);
  assert.match(script,/pg_dump -h \/var\/run\/postgresql -p 5432/);
  assert.match(script,/--no-owner --no-acl --no-tablespaces/);
  assert.match(script,/--no-publications --no-subscriptions/);
  assert.match(script,/psql -X -w -h \/var\/run\/postgresql/);
  assert.match(script,/current_database\(\).*current_user/);
  assert.doesNotMatch(script,/--data-only|--inserts|--column-inserts/);
});

test('ENK-08 clone: source migration drift and archive provenance must block',()=>{
  assert.match(script,/preflightBusinessDatabase/);
  assert.match(script,/auditEnk08Historical021/);
  assert.match(script,/schema_migrations|migration ledger/);
  assert.match(script,/report\.checksum_mismatch\.length/);
  assert.match(script,/history\.provenance_verified_for_review/);
  assert.ok(script.includes('migrations/$n'));
});

test('ENK-08 clone: review SQL is committed only as a temporary transaction',()=>{
  assert.ok(script.includes('psql_temp "$clone_db" -q -1'));
  assert.match(script,/expected 8|Expected 8/);
  assert.match(script,/LIVE RELEASE STOP/);
  assert.match(script,/No data was cloned/);
});
