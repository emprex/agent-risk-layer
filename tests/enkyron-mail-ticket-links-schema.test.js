import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import crypto from 'node:crypto';
import {
  VERSION,PREREQUISITES,parseArgs,assessMigrationRows
} from '../scripts/enkyron-mail-ticket-links-schema.mjs';

const sql=readFileSync(new URL('../migrations/'+VERSION,import.meta.url));
const digest=crypto.createHash('sha256').update(sql).digest('hex');
const checksums=Object.fromEntries([...PREREQUISITES,VERSION].map(version=>[
  version,crypto.createHash('sha256').update(
    readFileSync(new URL('../migrations/'+version,import.meta.url))
  ).digest('hex')
]));
const ledger=PREREQUISITES.map(version=>({version,checksum:checksums[version]}));

test('schema 116 installer is read-only by default and refuses every unapproved apply variant',()=>{
  assert.deepEqual(parseArgs(['--check'],digest),{mode:'check'});
  assert.deepEqual(parseArgs(['--apply','--confirm='+VERSION,'--sha256='+digest],digest),
    {mode:'apply'});
  for(const args of [
    [],['--apply'],['--apply','--force'],['--apply','--confirm='+VERSION],
    ['--check','--apply'],['--apply','--confirm='+VERSION,'--sha256='+'0'.repeat(64)],
    ['--apply','--confirm=113_enkyron_mail_content_archive.sql','--sha256='+digest],
    ['--apply','--confirm='+VERSION,'--sha256='+digest,'--force'],
    ['--apply','--confirm='+VERSION,'--sha256='+digest,'--dbname=arl_local']
  ])assert.throws(()=>parseArgs(args,digest),/No migration, backup, or database connection/);
});

test('migration preflight rejects missing, drifted or forged history',()=>{
  assert.equal(assessMigrationRows(ledger,checksums),'READY');
  assert.equal(assessMigrationRows([...ledger,{version:VERSION,checksum:digest}],
    checksums),'APPLIED');
  assert.throws(()=>assessMigrationRows([],checksums),/prerequisite/);
  assert.throws(()=>assessMigrationRows(
    ledger.filter(x=>x.version!==PREREQUISITES[1]),checksums),/prerequisite/);
  assert.throws(()=>assessMigrationRows(
    ledger.map(x=>x.version===PREREQUISITES[1]?
      {...x,checksum:'0'.repeat(64)}:x),checksums),/checksum drift/);
  assert.throws(()=>assessMigrationRows(
    [...ledger,{version:VERSION,checksum:'0'.repeat(64)}],checksums),
    /checksum drift/);
  assert.throws(()=>assessMigrationRows([...ledger,ledger[0]],checksums),
    /duplicated migration ledger/);
});

test('unapproved CLI invocation exits before attempting database connection',()=>{
  const result=spawnSync(process.execPath,
    ['scripts/enkyron-mail-ticket-links-schema.mjs','--apply'],{
      encoding:'utf8',timeout:10000
    });
  assert.equal(result.error,undefined);
  assert.equal(result.status,1);
  assert.match(result.stderr,/No migration, backup, or database connection was attempted/);
  assert.doesNotMatch(result.stderr,/ECONNREFUSED|password authentication|pg_dump/);
});
