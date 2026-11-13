import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateCompanyProposalDraftCreate,createCompanyProposalDraft
} from '../desktop/enkyron-crm-company-proposal-create.mjs';
const COMPANY='11111111-2222-4333-8444-555555555555';
const OPP='22222222-3333-4444-8555-666666666666';
const QUAL='33333333-4444-4555-8666-777777777777';
const DRAFT='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const EVENT='bbbbbbbb-1111-4222-8333-444444444444';
const input={
  company_id:COMPANY,opportunity_id:OPP,qualification_id:QUAL,
  expected_opportunity_version:2,
  title:'Synthetic security assessment — internal draft',
  scope_text:'Synthetic assessment of agent and MCP workflow security, not a client engagement.',
  currency:'GBP',amount_minor:120000,confirmed:true
};

function fixture({company=true,opp=true,stage='qualified',version=2,fit='potential_fit',
                  qual=QUAL,drafts=0,failAt=null}={}){
  const queries=[],released=[];
  const pool={connect:async()=>({
    query:async(sql,params)=>{
      queries.push({sql,params});
      if(sql.includes(failAt??'~~never_match~~'))throw Error('synthetic SQL failure');
      if(sql.includes('FROM enkyron_crm_companies'))return {
        rows:company?[{id:COMPANY}]:[]
      };
      if(sql.includes('FROM enkyron_crm_opportunities'))return {
        rows:opp?[{id:OPP,company_id:COMPANY,stage,version}]:[]
      };
      if(sql.includes('FROM enkyron_crm_qualification_reviews'))return {
        rows:qual?[{id:qual,fit_status:fit}]:[]
      };
      if(sql.includes('FROM enkyron_crm_proposal_drafts'))
        return {rows:[{n:drafts}]};
      return {rows:[]};
    },release:()=>released.push(true)
  })};
  return {pool,queries,released};
}

test('no missing price, no inferred confirmation and exact IDs/versions required',()=>{
  assert.equal(validateCompanyProposalDraftCreate(input).amount_minor,120000);
  for(const bad of [
    null,{},[],{...input,confirmed:false},{...input,confirmed:undefined},
    {...input,company_id:'other'},{...input,qualification_id:'bad'},
    {...input,opportunity_id:'other'},{...input,expected_opportunity_version:0},
    {...input,amount_minor:0},{...input,amount_minor:'120000'},
    {...input,currency:'AUTO'},{...input,scope_text:'short'},
  ])assert.throws(()=>validateCompanyProposalDraftCreate(bad),/CRM/);
});

test('successful guarded creation is one atomic draft and event with human-set price',async()=>{
  const {pool,queries,released}=fixture();
  const ids=[DRAFT,EVENT];
  const result=await createCompanyProposalDraft(pool,input,'ci-user',{uuid:()=>ids.shift()});
  assert.deepEqual({
    id:result.id,revision:result.revision,
    company_id:result.company_id,opportunity_id:result.opportunity_id,
    qualification_id:result.qualification_id
  },{
    id:DRAFT,revision:1,company_id:COMPANY,opportunity_id:OPP,
    qualification_id:QUAL
  });
  assert.deepEqual(queries.map(x=>x.sql.trim().split(/\s+/)[0]),[
    'BEGIN','SELECT','SELECT','SELECT','SELECT','SELECT',
    'INSERT','INSERT','COMMIT'
  ]);
  assert.match(queries[1].sql,/pg_advisory_xact_lock/);
  assert.deepEqual(queries[2].params,['local:ci-user',COMPANY]);
  assert.deepEqual(queries[3].params,['local:ci-user',OPP,COMPANY]);
  assert.match(queries[3].sql,/source_ticket_id IS NULL/);
  assert.deepEqual(queries[4].params,['local:ci-user',COMPANY]);
  assert.match(queries[4].sql,/contact_id IS NULL/);
  assert.deepEqual(queries[5].params,['local:ci-user',OPP]);
  assert.deepEqual(queries[6].params.slice(0,7),[
    DRAFT,'local:ci-user',OPP,input.title,input.scope_text,'GBP',120000
  ]);
  assert.equal(queries[7].params[0],EVENT);
  assert.match(queries[7].params[3],/^[a-f0-9]{64}$/);
  assert.equal(queries.some(x=>/\b(UPDATE|DELETE)\b/.test(x.sql)),false);
  assert.equal(released.length,1);
});

test('all stale/mislinked/double-draft/preparation denials roll back before INSERT',async()=>{
  const cases=[
    {company:false},{opp:false},{stage:'research'},
    {stage:'lost'},{version:3},{qual:null},{qual:'44444444-5555-4666-8777-888888888888'},
    {fit:'not_fit'},{drafts:1},{failAt:'FROM enkyron_crm_opportunities'}
  ];
  for(const spec of cases){
    const {pool,queries,released}=fixture(spec);
    await assert.rejects(()=>createCompanyProposalDraft(pool,input,'ci-user'),/CRM|synthetic SQL failure/);
    assert.equal(queries.at(-1).sql,'ROLLBACK');
    assert.equal(queries.some(x=>x.sql.trim().startsWith('INSERT')),false);
    assert.equal(released.length,1);
  }
  const {pool}=fixture();
  await assert.rejects(()=>createCompanyProposalDraft(pool,input,'invalid/actor'),/invalid local operator/);
});
