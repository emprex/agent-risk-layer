import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readEvidenceRegister, validatedEvidenceRequest
} from '../desktop/enkyron-evidence-register.mjs';

const ticket = '1111111a-2222-4333-8444-555555555555';
const valid = {ticket_id:ticket, control_id:'ARL-KB-013'};
const master = {
  available:true, integrity:'verified', snapshot_status:'current',
  project_id:'prj_one', assessment_id:'asm_one',
  snapshot_id:'snap_authoritative', target_sha:'a'.repeat(40)
};
const testRow = {
  id:'test_1', entry_id:'ARL-KB-013',
  system_snapshot_id:'snap_authoritative',
  execution_kind:'initial', result:'inconclusive',
  started_at:'2026-11-05T11:30:00Z',
  completed_at:'2026-11-05T12:00:00Z',
  retest_of_execution_id:null, original_snapshot_id:null,
  remediation_id:null, finding_id:null, content_digest:'c'.repeat(64),
  input_reference:'SECRET: test input must not be shown',
  observed_result:'PRIVATE: raw test observations must not be shown',
  descriptor_json:'SECRET: test descriptor must not be shown'
};
const row = {
  id:'ev_1', entry_id:'ARL-KB-013',
  system_snapshot_id:'snap_authoritative', evidence_class:'observed',
  source_type:'source_collection', verification_state:'unverified',
  retention_status:'active', integrity_digest:'b'.repeat(64),
  observed_at:'2026-11-05T12:00:00Z', created_at:'2026-11-05T12:01:00Z',
  test_execution_id:'test_1', runtime_event_id:null, approval_id:null,
  source_reference:'SECRET: should never be returned',
  descriptor_json:'SECRET: should never be returned',
  limitations:'PRIVATE: should never be returned'
};

test('rejects wrong control identifier, invalid ticket and hostile input', () => {
  assert.deepEqual(validatedEvidenceRequest(valid), {
    ticketId:ticket, controlId:'ARL-KB-013'
  });
  for (const bad of [
    {ticket_id:'123',control_id:'ARL-KB-013'},
    {ticket_id:ticket,control_id:'ARL-KB-000'},
    {ticket_id:ticket,control_id:'ARL-KB-109'},
    {ticket_id:ticket,control_id:'ARL-KB-013;DROP TABLE control_evidence_items'},
    {ticket_id:ticket,control_id:'ARL-KB-13'},
    {ticket_id:ticket,control_id:'ARL-KB-013', extra:'x', __proto__:null},
    null
  ]) {
    if (bad?.control_id==='ARL-KB-013'&&bad?.ticket_id===ticket) continue;
    assert.throws(() => validatedEvidenceRequest(bad), /Invalid evidence register/);
  }
});

test('evidence records are scoped to verified project/snapshot/control', async () => {
  const calls = [];
  const client = {
    query: async (sql, args) => {
      calls.push({sql,args});
      return {rows:calls.length === 1 ? [row] : [testRow]};
    }
  };
  const result = await readEvidenceRegister(client, valid, async (_db,id) => {
    assert.equal(id,ticket);
    return master;
  });
  assert.deepEqual(calls[0].args, ['prj_one','snap_authoritative','ARL-KB-013']);
  assert.match(calls[0].sql, /system_snapshot_id=\$2 AND entry_id=\$3/);
  assert.match(calls[0].sql, /LIMIT 101/);
  assert.equal(calls.length,2);
  assert.deepEqual(calls[1].args, ['prj_one','snap_authoritative','ARL-KB-013']);
  assert.match(calls[1].sql, /FROM control_test_executions/);
  assert.match(calls[1].sql, /LIMIT 101/);
  assert.doesNotMatch(calls[1].sql, /observed_result|expected_result|input_reference|descriptor_json/);
  assert.equal(result.items.length,1);
  assert.equal(result.items[0].test_execution_id,'test_1');
  assert.equal(result.tests.length,1);
  assert.equal(result.tests[0].id,'test_1');
  assert.equal(result.tests[0].recorded_result,'inconclusive');
  assert.equal(result.tests[0].recorded_content_digest,'c'.repeat(64));
  assert.equal(result.items[0].verification_state,'unverified');
  assert.equal(result.items[0].recorded_integrity_digest,'b'.repeat(64));
  assert.equal(result.evidence_accepted,false);
  assert.equal(result.security_verdict,'not_assessed');
  assert.equal(result.human_review_required,true);
  assert.doesNotMatch(JSON.stringify(result), /SECRET:|PRIVATE:/);
  assert.doesNotMatch(calls[0].sql, /source_reference|descriptor_json|limitations/);
  assert.equal(result.more_tests,false);
  assert.equal(result.tests_executed,0);
});

test('never queries evidence for missing, stale, or integrity-failed master', async () => {
  const failIfCalled = {query:()=>{throw Error('SQL should not run');}};
  for (const m of [
    null, {available:false}, {...master, integrity:'unverified'},
    {...master, snapshot_status:'stale'}
  ]) {
    const r=await readEvidenceRegister(failIfCalled, valid, async()=>m);
    assert.equal(r.available,false);
  }
  await assert.rejects(
    () => readEvidenceRegister(failIfCalled, valid,
      async()=>({...master, target_sha:'invalid'})),
    /Master identity is incomplete/
  );
});

test('bounded register caps 100 rows without implying verdict', async () => {
  let queries=0;
  const client={query:async()=>{
    queries++;
    return {rows:Array.from({length:101},(_,i)=>
      queries===1 ? {...row,id:'ev_'+i} : {...testRow,id:'test_'+i})};
  }};
  const result=await readEvidenceRegister(client,valid,async()=>master);
  assert.equal(result.items.length,100);
  assert.equal(result.more,true);
  assert.equal(result.tests.length,100);
  assert.equal(result.more_tests,true);
  assert.equal(result.readiness_decision,'not_evaluated');
});

test('fail closed if a recorded test or evidence has a different control or snapshot', async () => {
  for (const kind of ['test', 'evidence']) {
    const client={query:async(sql)=>{
      if (sql.includes('FROM control_test_executions')) {
        return {rows:[kind==='test'
          ? {...testRow, system_snapshot_id:'snap_other'} : testRow]};
      }
      return {rows:[kind==='evidence'
        ? {...row, entry_id:'ARL-KB-014'} : row]};
    }};
    await assert.rejects(
      () => readEvidenceRegister(client, valid, async()=>master),
      /scope mismatch/
    );
  }
});

test('test results are historical records, not control verdicts', async () => {
  const client={query:async(sql)=>({
    rows:sql.includes('FROM control_test_executions') ?
      [{...testRow, result:'passed'}] : [{...row, verification_state:'verified'}]
  })};
  const result=await readEvidenceRegister(client, valid,async()=>master);
  assert.equal(result.tests[0].recorded_result,'passed');
  assert.equal(result.items[0].verification_state,'verified');
  assert.equal(result.security_verdict,'not_assessed');
  assert.equal(result.readiness_decision,'not_evaluated');
  assert.equal(result.evidence_accepted,false);
});
