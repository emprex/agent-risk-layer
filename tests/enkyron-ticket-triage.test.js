import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateTicketTriage,readTicketTriage,recordTicketTriage,
  REQUEST_TYPES,TRIAGE_LEVELS,TICKET_PRIORITIES
} from '../desktop/enkyron-ticket-triage.mjs';

const id='11111111-2222-4333-8444-555555555555';
const review={
  ticket_id:id,request_type:'assessment_request',impact:'medium',urgency:'low',
  priority:'normal',expected_latest_id:null,confirmed:true,
  review_note:'Operator reviewed this synthetic request and set its initial triage.'
};
test('E03 triage requires explicit type, priority, rationale and optimistic revision',()=>{
  assert.equal(REQUEST_TYPES.length,6);
  assert.equal(TRIAGE_LEVELS.length,3);
  assert.equal(TICKET_PRIORITIES.length,4);
  assert.equal(validateTicketTriage(review).priority,'normal');
  for(const bad of [
    {...review,request_type:'other'},{...review,impact:'critical'},
    {...review,urgency:'automatic'},{...review,priority:'p0'},
    {...review,confirmed:false},{...review,expected_latest_id:undefined},
    {...review,review_note:'short'},{...review,extra:'unknown'},
    {...review,ticket_id:'fake'},{...review,review_note:'a\u0000b'.repeat(30)}
  ])assert.throws(()=>validateTicketTriage(bad));
});
test('E03 triage read fails visibly closed when new migration is absent',async()=>{
  const missing={query:async()=>{let e=new Error('missing');e.code='42P01';throw e;}};
  const r=await readTicketTriage(missing,id);
  assert.equal(r.available,false);
  assert.equal(r.current,null);
});
test('E03 triage refuses stale or already archived reviews without writes',async()=>{
  for(const {old,archived,message} of [
    {old:'66666666-2222-4333-8444-555555555555',archived:false,message:/changed/},
    {old:null,archived:true,message:/Closed or archived/}
  ]){
    const statements=[];
    const client={
      query:async(sql,params)=>{
        statements.push({sql,params});
        if(sql.startsWith('SELECT status'))return {rows:[{status:'new',archived_at:archived?'2026-11-07':null}]};
        if(sql.startsWith('SELECT id,request_type'))return {rows:old?[{id:old}]:[]};
        return {rows:[]};
      },release:()=>{}
    };
    await assert.rejects(()=>recordTicketTriage({connect:async()=>client},review,
      'ci-operator'),message);
    assert.ok(statements.some(x=>x.sql==='ROLLBACK'));
    assert.ok(!statements.some(x=>x.sql.startsWith('INSERT')));
  }
});
