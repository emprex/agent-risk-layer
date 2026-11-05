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
const row = {
  id:'ev_1', entry_id:'ARL-KB-013',
  system_snapshot_id:'snap_authoritative', evidence_class:'observed',
  source_type:'source_collection', verification_state:'unverified',
  retention_status:'active', integrity_digest:'b'.repeat(64),
  observed_at:'2026-11-05T12:00:00Z', created_at:'2026-11-05T12:01:00Z',
  test_execution_id:null, runtime_event_id:null, approval_id:null,
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
      return {rows:[row]};
    }
  };
  const result = await readEvidenceRegister(client, valid, async (_db,id) => {
    assert.equal(id,ticket);
    return master;
  });
  assert.deepEqual(calls[0].args, ['prj_one','snap_authoritative','ARL-KB-013']);
  assert.match(calls[0].sql, /system_snapshot_id=\$2 AND entry_id=\$3/);
  assert.match(calls[0].sql, /LIMIT 101/);
  assert.equal(result.items.length,1);
  assert.equal(result.items[0].verification_state,'unverified');
  assert.equal(result.items[0].recorded_integrity_digest,'b'.repeat(64));
  assert.equal(result.evidence_accepted,false);
  assert.equal(result.security_verdict,'not_assessed');
  assert.equal(result.human_review_required,true);
  assert.doesNotMatch(JSON.stringify(result), /SECRET:|PRIVATE:/);
  assert.doesNotMatch(calls[0].sql, /source_reference|descriptor_json|limitations/);
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
  const client={query: async()=>({rows:Array.from({length:101},(_,i)=>({...row,id:'ev_'+i}))})};
  const result=await readEvidenceRegister(client,valid,async()=>master);
  assert.equal(result.items.length,100);
  assert.equal(result.more,true);
  assert.equal(result.readiness_decision,'not_evaluated');
});
