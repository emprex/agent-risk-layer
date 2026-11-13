import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateQualificationReview,recordQualificationReview,
  FIT_STATES,PRIORITIES
} from '../desktop/enkyron-crm-qualification.mjs';
const company='11111111-2222-4333-8444-555555555555';
const contact='22222222-3333-4444-8555-666666666666';
const id='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const input={
  company_id:company,contact_id:contact,fit_status:'potential_fit',
  priority:'high',rationale:'Public material suggests a possible agentic security buyer.',
  source_reference:'https://example.invalid/about',
  next_action:'Confirm business scope manually before outreach',
  confirmed:true
};
test('commercial fit is distinct from verified identity or permission',()=>{
  assert.deepEqual(FIT_STATES,['needs_research','potential_fit','not_fit','on_hold']);
  assert.deepEqual(PRIORITIES,['low','normal','high']);
  const review=validateQualificationReview(input);
  assert.equal(review.contact_id,contact);
  assert.equal(review.fit_status,'potential_fit');
  assert.equal(review.confirmed,undefined);
  assert.equal(validateQualificationReview({...input,contact_id:null,
    next_action:'',source_reference:''}).next_action,null);
  for(const invalid of [
    null,{},[],{...input,company_id:'bad'},
    {...input,contact_id:'bad'},{...input,fit_status:'client'},
    {...input,priority:'ultra'},{...input,confirmed:false},
    {...input,rationale:'too short'},
    {...input,rationale:'a'.repeat(1501)},
    {...input,rationale:'good rationale for this company\nmore detail',next_action:'x'},
    {...input,source_reference:'\u0000'},
  ])assert.throws(()=>validateQualificationReview(invalid),/CRM/);
});
test('validated company and contact are checked in same transaction before append',async()=>{
  const queries=[];let released=0;
  const pool={connect:async()=>({
    query:async(sql,params)=>{
      queries.push({sql,params});
      if(sql.includes('FROM enkyron_crm_companies'))return {rows:[{id:company}]};
      if(sql.includes('FROM enkyron_crm_contacts'))return {rows:[{id:contact}]};
      return {rows:[]};
    },release:()=>{released++;}
  })};
  const result=await recordQualificationReview(pool,input,'ci-operator',{uuid:()=>id});
  assert.equal(result.id,id);
  assert.equal(result.company_id,company);
  assert.deepEqual(queries.map(q=>q.sql.split(' ')[0]),[
    'BEGIN','SELECT','SELECT','INSERT','COMMIT'
  ]);
  assert.deepEqual(queries[1].params,['local:ci-operator',company]);
  assert.deepEqual(queries[2].params,['local:ci-operator',company,contact]);
  assert.match(queries[3].sql,/INSERT INTO enkyron_crm_qualification_reviews/);
  assert.ok(!queries.some(q=>/UPDATE enkyron_crm_companies|UPDATE enkyron_crm_contacts|INSERT INTO sales_messages/i.test(q.sql)));
  assert.equal(released,1);
});
test('different-company contact is refused and transaction rolled back',async()=>{
  const statements=[];
  const db={connect:async()=>({
    query:async(sql)=>{
      statements.push(sql);
      if(sql.includes('FROM enkyron_crm_companies'))return {rows:[{id:company}]};
      return {rows:[]};
    },release:()=>{}
  })};
  await assert.rejects(()=>recordQualificationReview(db,input,'ci-operator'),
    /does not belong/);
  assert.equal(statements.at(-1),'ROLLBACK');
  assert.ok(!statements.some(q=>q.startsWith('INSERT')));
});
