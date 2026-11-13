import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {
  validateCompanyProposalScopeRevision,
  reviseCompanyProposalScope,
  readCompanyProposalContentVersions
} from '../desktop/enkyron-crm-proposal-content-revisions.mjs';

const COMPANY='0e5993e3-be9a-4837-9350-989079c2cc2f';
const OPPORTUNITY='17d0d77c-3052-40e3-a38d-33fd4867e5d4';
const DRAFT='d35d86b8-b16f-41c8-940d-f8e7c1dc1db8';
const OLD_EVENT='f7a659a4-20d8-4439-a779-e900815aed31';
const NEW_EVENT='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const OLD_SNAPSHOT='bbbbbbbb-1111-4222-8333-444444444444';
const NEW_SNAPSHOT='cccccccc-1111-4222-8333-444444444444';
const TITLE='ENK04 SYNTHETIC UAT — AI-Agent Security Assessment';
const OLD_SCOPE='ENK04 SYNTHETIC UAT ONLY — INTERNAL DRAFT.Copier le texte';
const NEW_SCOPE='ENK04 SYNTHETIC UAT ONLY — INTERNAL DRAFT.\n\n'
  +'Scope: human review of AI-agent architecture and MCP trust boundaries.\n'
  +'Deliverables: documentary risk review only.\n'
  +'This is not a client quotation or permission to test.';
const input={
  proposal_id:DRAFT,company_id:COMPANY,opportunity_id:OPPORTUNITY,
  expected_revision:1,scope_text:NEW_SCOPE,
  review_note:'Correct copied interface text and paragraph boundaries; keep GBP 1.00 and the old revision.',
  confirmed:true
};
const digest=(title,scope,currency,minor)=>
  createHash('sha256').update(JSON.stringify([title,scope,currency,minor])).digest('hex');
const OLD_SHA=digest(TITLE,OLD_SCOPE,'GBP',100);
const NEW_SHA=digest(TITLE,NEW_SCOPE,'GBP',100);
const prior={id:DRAFT,opportunity_id:OPPORTUNITY,company_id:COMPANY,
  title:TITLE,scope_text:OLD_SCOPE,currency:'GBP',amount_minor:'100',revision:1,
  source_ticket_id:null};

function stub({existing=null,version=1,hash=OLD_SHA,downstream=false,failOn='~~none~~',
  current=prior}={}){
  const calls=[],released=[];
  const db={connect:async()=>({
    query:async(sql,params)=>{
      calls.push({sql,params});
      if(sql.includes(failOn))throw new Error('injected SQL error');
      if(sql.includes('FROM enkyron_crm_proposal_drafts d')&&sql.includes('FOR UPDATE'))
        return {rows:current?[{...current,revision:version}]:[]};
      if(sql.includes('FROM enkyron_crm_proposal_draft_events'))
        return {rows:[{id:OLD_EVENT,content_sha256:hash}]};
      if(sql.includes('FROM enkyron_crm_proposal_lines'))
        return {rows:[{lines:downstream?1:0,decisions:0,sow_versions:0}]};
      if(sql.includes('FROM enkyron_crm_proposal_content_versions'))
        return {rows:existing?[existing]:[]};
      if(sql.startsWith('UPDATE enkyron_crm_proposal_drafts'))
        return {rows:[{revision:version+1}]};
      return {rows:[]};
    },release:()=>released.push(true)
  })};
  return {db,calls,released};
}

test('text correction requires human confirmation, exact IDs and a written rationale',()=>{
  const valid=validateCompanyProposalScopeRevision(input);
  assert.equal(valid.company_id,COMPANY);
  assert.equal(valid.expected_revision,1);
  assert.equal(valid.scope_text,NEW_SCOPE);
  for(const bad of [
    null,{},[],{...input,confirmed:false},{...input,confirmed:undefined},
    {...input,proposal_id:'wrong'},{...input,company_id:'wrong'},
    {...input,opportunity_id:'wrong'},{...input,expected_revision:0},
    {...input,expected_revision:'1'},{...input,scope_text:''},
    {...input,scope_text:'Copier le texte in an internal contract.'},
    {...input,scope_text:'A'.repeat(5001)},
    {...input,review_note:'too short'}
  ])assert.throws(()=>validateCompanyProposalScopeRevision(bad),/CRM/);
});

test('atomic revision archives complete original before editing and saves new immutable snapshot',async()=>{
  const {db,calls,released}=stub();
  const ids=[OLD_SNAPSHOT,NEW_EVENT,NEW_SNAPSHOT];
  const out=await reviseCompanyProposalScope(db,input,'emprex',{uuid:()=>ids.shift()});
  assert.equal(out.id,DRAFT);
  assert.equal(out.revision,2);
  assert.equal(out.previous_revision,1);
  assert.equal(out.previous_content_sha256,OLD_SHA);
  assert.equal(out.content_sha256,NEW_SHA);
  assert.equal(out.amount_minor,100);
  assert.equal(out.currency,'GBP');
  assert.equal(out.previous_snapshot_id,OLD_SNAPSHOT);
  assert.equal(out.new_snapshot_id,NEW_SNAPSHOT);
  assert.deepEqual(calls.map(x=>x.sql.split(' ')[0]),[
    'BEGIN','SELECT','SELECT','SELECT','SELECT','INSERT','UPDATE',
    'INSERT','INSERT','COMMIT'
  ]);
  assert.deepEqual(calls[1].params,['local:emprex',DRAFT,OPPORTUNITY,COMPANY]);
  assert.match(calls[1].sql,/o[.]source_ticket_id IS NULL/);
  assert.match(calls[1].sql,/FOR UPDATE OF d/);
  assert.deepEqual(calls[2].params,['local:emprex',DRAFT,1]);
  assert.deepEqual(calls[4].params,['local:emprex',DRAFT,1]);
  assert.equal(calls[5].params[5],OLD_SCOPE);
  assert.equal(calls[5].params[8],OLD_SHA);
  assert.equal(calls[5].params[9],OLD_EVENT);
  assert.deepEqual(calls[6].params,[
    'local:emprex',DRAFT,NEW_SCOPE,2,'emprex',1
  ]);
  assert.equal(calls[7].params[0],NEW_EVENT);
  assert.equal(calls[7].params[4],NEW_SHA);
  assert.equal(calls[8].params[5],NEW_SCOPE);
  assert.equal(calls[8].params[10],input.review_note);
  assert.equal(calls[8].params[9],NEW_EVENT);
  assert.equal(calls[9].sql,'COMMIT');
  assert.equal(released.length,1);
  assert.equal(calls.filter(x=>x.sql.startsWith('UPDATE')).length,1);
  assert.equal(calls.filter(x=>x.sql.startsWith('DELETE')).length,0);
  assert.ok(!calls.some(x=>/mail-send|invoice-issue|create-ticket/i.test(x.sql)));
});

test('wrong revision, altered original, blocked downstream and malformed snapshots roll back',async()=>{
  const wrongSnapshot={
    id:OLD_SNAPSHOT,title:TITLE,scope_text:'TAMPERED',currency:'GBP',
    amount_minor:'100',content_sha256:OLD_SHA,source_event_id:OLD_EVENT
  };
  for(const options of [
    {current:null},{version:2},{hash:'f'.repeat(64)},
    {downstream:true},{existing:wrongSnapshot},
    {failOn:'FROM enkyron_crm_proposal_draft_events'}
  ]){
    const {db,calls,released}=stub(options);
    await assert.rejects(()=>reviseCompanyProposalScope(db,input,'emprex'),/CRM|injected/);
    assert.equal(calls.at(-1).sql,'ROLLBACK');
    assert.equal(calls.some(x=>x.sql.startsWith('UPDATE')),false);
    assert.equal(calls.some(x=>x.sql.startsWith('INSERT')),false);
    assert.equal(released.length,1);
  }
  const same=stub();
  await assert.rejects(()=>reviseCompanyProposalScope(same.db,{
    ...input,scope_text:OLD_SCOPE.replace('Copier le texte','')
  },'operator name'),/invalid local operator/);
});

test('read-only versions are scoped to company+operator and bounded',async()=>{
  const calls=[],released=[];
  const database={connect:async()=>({
    query:async(sql,params)=>{
      calls.push({sql,params});
      if(sql.includes('FROM enkyron_crm_proposal_drafts d'))
        return {rows:[{id:DRAFT,revision:2,currency:'GBP',amount_minor:'100'}]};
      if(sql.includes('FROM enkyron_crm_proposal_content_versions'))
        return {rows:[
          {id:OLD_SNAPSHOT,revision:1,scope_text:OLD_SCOPE,content_sha256:OLD_SHA},
          {id:NEW_SNAPSHOT,revision:2,scope_text:NEW_SCOPE,content_sha256:NEW_SHA},
        ]};
      return {rows:[]};
    },release:()=>released.push(true)
  })};
  const out=await readCompanyProposalContentVersions(database,{
    proposal_id:DRAFT,company_id:COMPANY
  },'emprex');
  assert.equal(out.current_revision,2);
  assert.deepEqual(out.versions.map(x=>x.scope_text),[OLD_SCOPE,NEW_SCOPE]);
  assert.match(calls[0].sql,/REPEATABLE READ READ ONLY/);
  assert.deepEqual(calls[1].params,['local:emprex',DRAFT,COMPANY]);
  assert.match(calls[1].sql,/o[.]source_ticket_id IS NULL/);
  assert.deepEqual(calls[2].params,['local:emprex',DRAFT]);
  assert.equal(calls.at(-1).sql,'COMMIT');
  assert.equal(released.length,1);
});
