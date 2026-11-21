import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {archivedAssessmentReport} from '../desktop/enkyron-final-report-reader.mjs';

const ticketId = '00000000-0000-4000-8000-000000000042';
const projectId = 'prj_' + 'a'.repeat(32);
const assessmentId = 'asm_' + 'b'.repeat(32);
const reportId = 'rpt_' + 'c'.repeat(32);
const actor = 'test-operator';
const content = Buffer.concat([Buffer.from('%PDF-1.7\n'),Buffer.alloc(1024,0x4c)]);
const digest = crypto.createHash('sha256').update(content).digest('hex');

function row(extra={}) {
  return {
    report_id:reportId,ticket_id:ticketId,project_id:projectId,
    assessment_id:assessmentId,ticket_number:'ARL-TEST-000042',
    source_commit:'d'.repeat(40),file_name:'synthetic-report.pdf',
    mime_type:'application/pdf',confidentiality:'confidential',
    document_kind:'final_security_assessment_report',
    content_sha256:digest,byte_length:content.length,content,
    archived_by:actor,archived_at:'2026-11-21T12:00:00Z',
    ...extra
  };
}

function readOnlyPool(report=row(), tableExists=true) {
  const calls=[];
  const pool={async query(sql,params=[]) {
    calls.push({sql,params});
    if (calls.length===1) {
      assert.match(sql,/^SELECT to_regclass/);
      return {rows:[{name:tableExists?'enkyron_assessment_final_reports':null}]};
    }
    if (calls.length===2) return {rows:report?[report]:[]};
    throw Error('Unexpected SQL call');
  }};
  return {pool,calls};
}

test('LA-03 returns only a verified synthetic PDF under the scoped local operator',async()=>{
  const {pool,calls}=readOnlyPool();
  const out=await archivedAssessmentReport(pool,ticketId,actor);
  assert.equal(out.available,true);
  assert.equal(out.integrity,'sha256_verified');
  assert.equal(out.report_id,reportId);
  assert.equal(out.project_id,projectId);
  assert.equal(out.assessment_id,assessmentId);
  assert.equal(out.content_sha256,digest);
  assert.equal(out.byte_length,content.length);
  assert.deepEqual(Buffer.from(out.content_base64,'base64'),content);
  assert.equal(calls.length,2);
  assert.deepEqual(calls[1].params,[ticketId,actor]);
  for(const term of [
    't.id=$1',"t.target_kind='git'",
    't.linked_project_id=r.project_id',
    't.linked_assessment_id=r.assessment_id',
    't.ticket_number=r.ticket_number',
    'p.agent_assessment_id=r.assessment_id',
    '(t.assigned_to=$2 OR t.assessor_name=$2)'
  ]) assert.ok(calls[1].sql.includes(term),'Missing scope guard: '+term);
  for(const call of calls) {
    assert.match(call.sql,/^SELECT/);
    assert.doesNotMatch(call.sql,/^\s*(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE)\b/i);
  }
});

test('LA-03 refuses invalid ticket IDs before querying PostgreSQL',async()=>{
  const {pool,calls}=readOnlyPool();
  await assert.rejects(archivedAssessmentReport(pool,'../report.pdf',actor));
  assert.equal(calls.length,0);
});

test('LA-03 handles absent archive table or inaccessible report without leaking bytes',async()=>{
  const missingTable=readOnlyPool(row(),false);
  const one=await archivedAssessmentReport(missingTable.pool,ticketId,actor);
  assert.equal(one.available,false);
  assert.equal(missingTable.calls.length,1);
  assert.equal(one.content_base64,undefined);
  const missingReport=readOnlyPool(null);
  const two=await archivedAssessmentReport(missingReport.pool,ticketId,actor);
  assert.equal(two.available,false);
  assert.equal(missingReport.calls.length,2);
  assert.equal(two.content_base64,undefined);
});

test('LA-03 rejects corrupted bytes, size, content type and archive metadata',async()=>{
  const tampered=[
    {content_sha256:'f'.repeat(64)},
    {content_sha256:'not-a-sha'},
    {byte_length:content.length+1},
    {byte_length:25000001},
    {content:Buffer.alloc(content.length,0)},
    {content:new Uint8Array(content)},
    {report_id:'rpt_bad'},
    {source_commit:'invalid'},
    {mime_type:'text/html'},
    {confidentiality:'public'},
    {document_kind:'working_notes'},
    {file_name:'a'},
  ];
  for(const change of tampered) {
    const f=readOnlyPool(row(change));
    await assert.rejects(
      archivedAssessmentReport(f.pool,ticketId,actor),
      /Archived report integrity check failed/,
      'Should refuse '+Object.keys(change)[0]
    );
    assert.equal(f.calls.length,2);
  }
});

test('migration 124 preserves the previously recorded script checksum',()=>{
  const sql=fs.readFileSync(new URL('../migrations/124_enkyron_assessment_final_reports.sql',import.meta.url));
  assert.equal(crypto.createHash('sha256').update(sql).digest('hex'),
    'afd48a7cb74bd3ea30ff47c666b5b70370f219fd56c666d82ad9609936ecdc52');
  assert.match(sql.toString(),/BEFORE UPDATE OR DELETE/);
  assert.match(sql.toString(),/content BYTEA NOT NULL/);
});
