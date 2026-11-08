import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import pg from 'pg';
import {createCompany} from '../desktop/enkyron-crm.mjs';
import {createDeskTicket} from '../desktop/enkyron-ticket-intake.mjs';
import {linkTicketToCompany} from '../desktop/enkyron-crm-tickets.mjs';
import {revokeTicketAssociation} from '../desktop/enkyron-crm-ticket-corrections.mjs';
import {createCompanyOpportunity} from '../desktop/enkyron-crm-opportunities.mjs';
import {createOpportunity} from '../desktop/enkyron-crm-opportunities.mjs';
import {createProposalDraft,updateProposalDraft} from '../desktop/enkyron-crm-proposals.mjs';
import {readBuyerReview,recordBuyerReview}
  from '../desktop/enkyron-crm-buyer-review.mjs';
const url=process.env.ARL_CI_POSTGRES_URL||'';
function disposable(){
  assert.equal(process.env.CI,'true');
  const u=new URL(url);
  assert.equal(u.hostname,'127.0.0.1');
  assert.equal(u.pathname,'/arl_ci');
  assert.equal(u.username,'arl_ci');
  assert.equal(u.password,'synthetic-ci-only');
  return url;
}
test('buyer review: explicit link, immutable revision, cross-workspace rejection',{
  skip:!url&&'Disposable CI database only',timeout:60000
},async()=>{
  const db=new pg.Pool({connectionString:disposable(),max:3});
  const actor='ci-buyer-'+randomUUID().slice(0,8);
  const other=actor+'-foreign';
  const id=randomUUID();
  const count=async table=>(await db.query(
    'SELECT count(*)::int AS n FROM '+table
  )).rows[0].n;
  try{
    const baseline={companies:await count('enkyron_crm_companies'),
      messages:await count('sales_messages'),tickets:await count('arl_workbench_tickets')};
    const uid='usr_buyer_'+randomUUID(),lead='lead_buyer_'+randomUUID();
    await db.query(
      'INSERT INTO users(id,email,password_hash,created_at) VALUES($1,$2,$3,NOW())',
      [uid,'ci-buyer-'+randomUUID()+'@example.invalid','synthetic-ci']);
    await db.query(
      'INSERT INTO sales_prospects '
      +'(id,company_name,source,created_by,created_at,updated_at) '
      +'VALUES($1,$2,$3,$4,NOW(),NOW())',
      [lead,'Research Prospect - UNVERIFIED','synthetic-ci',uid]);
    const opp=await createOpportunity(db,{
      prospect_id:lead,company_name_at_review:'Research Prospect - UNVERIFIED',
      next_action:'Manually establish the correct legal buyer from documents',
      due_date:'2026-11-20'
    },actor);
    const proposal=await createProposalDraft(db,{
      opportunity_id:opp.id,title:'Manual cyber review draft only',
      scope_text:'Human-proposed services, no assessment authorised or started.',
      currency:'GBP',amount_minor:50000
    },actor);
    const crm=await createCompany(db,{
      name:'Synthetic CRM Client',
      legal_name:'Synthetic Legal Client Ltd',city:'London',country:'GB',
      website:'https://example.invalid',sector:'Security testing'
    },actor);
    const second=await createCompany(db,{
      name:'Unrelated homonym',
      legal_name:'Synthetic Legal Client Ltd',city:'London',country:'GB',
      website:'https://other.example.invalid',sector:'Other',
      duplicate_review:{match_ids:[crm.id],confirmed:true,
        review_note:'Distinct synthetic legal buyer homonym reviewed without merging entities.'}
    },actor);
    const payload={proposal_id:proposal.id,expected_revision:1,
      company_id:crm.id,confirmed:true,
      legal_name:'Synthetic Legal Client Ltd',
      registered_address:'10 Fictional Street, London, EX1 2AB',
      source_reference:'Synthetic Companies Registry fixture 00000000',
      review_note:'A human transcribed this synthetic registry fixture; it is not independently verified.'};
    const unlinked=await readBuyerReview(db,proposal.id,actor);
    assert.equal(unlinked.linked_company,null);
    await assert.rejects(()=>recordBuyerReview(db,payload,actor),/linked/);
    await db.query(
      'INSERT INTO enkyron_crm_prospect_links '
      +'(id,workspace_key,prospect_id,company_id,source_digest,review_note,linked_by) '
      +'VALUES($1,$2,$3,$4,$5,$6,$7)',
      [randomUUID(),'local:'+actor,lead,crm.id,
        createHash('sha256').update('synthetic-ci-link').digest('hex'),
        'Manually linked the synthetic prospect to the controlled company fixture.',
        actor]
    );
    const linked=await readBuyerReview(db,proposal.id,actor);
    assert.equal(linked.linked_company.id,crm.id);
    await assert.rejects(()=>recordBuyerReview(db,{
      ...payload,company_id:second.id
    },actor),/linked/);
    await assert.rejects(()=>readBuyerReview(db,proposal.id,other),
      /not found in local workspace/);
    const saved=await recordBuyerReview(db,payload,actor);
    assert.equal(saved.review_status,'operator_documented_unverified');
    const readback=await readBuyerReview(db,proposal.id,actor);
    assert.equal(readback.current.legal_name,'Synthetic Legal Client Ltd');
    assert.equal(readback.current.proposal_revision,1);
    assert.equal(readback.history.length,1);
    assert.equal(readback.history[0].registered_address,undefined);
    await assert.rejects(()=>recordBuyerReview(db,payload,actor),/already recorded/);
    const record=(await db.query(
      'SELECT id FROM enkyron_crm_proposal_buyer_reviews WHERE id=$1',[saved.id]
    )).rows[0];
    await assert.rejects(()=>db.query(
      'UPDATE enkyron_crm_proposal_buyer_reviews SET legal_name=$1 WHERE id=$2',
      ['Tampered',record.id]),/cannot be changed or deleted/);
    await assert.rejects(()=>db.query(
      'DELETE FROM enkyron_crm_proposal_buyer_reviews WHERE id=$1',
      [record.id]),/cannot be changed or deleted/);
    const revised=await updateProposalDraft(db,{
      id:proposal.id,expected_revision:1,
      title:'Revised cyber review draft only',
      scope_text:'Human-proposed services, no assessment authorised or started.',
      currency:'GBP',amount_minor:50000
    },actor);
    assert.equal(revised.revision,2);
    const reopened=await readBuyerReview(db,proposal.id,actor);
    assert.equal(reopened.proposal_revision,2);
    assert.equal(reopened.current,null);
    assert.equal(reopened.history[0].proposal_revision,1);
    await assert.rejects(()=>recordBuyerReview(db,{
      ...payload,expected_revision:1
    },actor),/proposal changed/);
    const saved2=await recordBuyerReview(db,{...payload,expected_revision:2},actor);
    assert.equal(saved2.proposal_revision,2);
    const after=await readBuyerReview(db,proposal.id,actor);
    assert.deepEqual(after.history.map(x=>x.proposal_revision),[2,1]);
    assert.equal(await count('sales_messages'),baseline.messages);
    assert.equal(await count('arl_workbench_tickets'),baseline.tickets);
    assert.equal(await count('enkyron_crm_companies'),baseline.companies+2);
    assert.equal(id.length,36);
  }finally{await db.end();}
});

test('buyer identity review on direct CRM company-ticket origin requires effective reviewed link', {
  skip:!url&&'Disposable CI database only',timeout:60000
},async()=>{
  const db=new pg.Pool({connectionString:disposable(),max:3});
  const actor='ci-buyer-direct-'+randomUUID().slice(0,8);
  const name='Synthetic E2E Buyer '+randomUUID().slice(0,7);
  try{
    const company=await createCompany(db,{name},actor);
    const twin=await createCompany(db,{name:name+' Other'},actor);
    const ticket=await createDeskTicket(db,{
      source:'manual',client_name:name,title:'Buyer review source ticket',
      request_text:'Synthetic company-scoped commercial quote; no customer authorisation.'
    },actor);
    await linkTicketToCompany(db,{
      company_id:company.id,ticket_id:ticket.id,
      ticket_client_name_at_review:name,
      review_note:'Operator reviewed the synthetic original company and ticket.',
      reviewed:true
    },actor);
    const opp=await createCompanyOpportunity(db,{
      company_id:company.id,ticket_id:ticket.id,
      company_name_at_review:name,ticket_number_at_review:ticket.ticket_number,
      next_action:'Prepare internal draft and examine buyer identity documents',
      due_date:null,confirmed:true
    },actor);
    const prop=await createProposalDraft(db,{
      opportunity_id:opp.id,title:'Synthetic scoping proposal',
      scope_text:'Human-reviewed proposal draft with no testing authorisation.',
      currency:'GBP',amount_minor:75000
    },actor);
    const buyer=await readBuyerReview(db,prop.id,actor);
    assert.equal(buyer.origin_kind,'reviewed_company_ticket');
    assert.equal(buyer.linked_company.id,company.id);
    assert.equal(buyer.linked_company.name,name);
    assert.equal(buyer.current,null);
    await assert.rejects(()=>readBuyerReview(db,prop.id,'ci-foreign-operator'),
      /not found in local workspace/);
    const input={proposal_id:prop.id,company_id:company.id,
      expected_revision:1,confirmed:true,
      legal_name:'Synthetic E2E Buyer (not verified)',
      registered_address:'10 Example Lane, Fictional Test City, UK',
      source_reference:'CI synthetic buyer identity fixture only',
      review_note:'Operator entered deliberately synthetic documentary data; no '
        +'independent legal verification or contractual acceptance.'};
    await assert.rejects(()=>recordBuyerReview(db,{
      ...input,company_id:twin.id
    },actor),/current reviewed CRM company association/);
    const saved=await recordBuyerReview(db,input,actor);
    assert.equal(saved.review_status,'operator_documented_unverified');
    const after=await readBuyerReview(db,prop.id,actor);
    assert.equal(after.current.company_id,company.id);
    assert.equal(after.current.proposal_revision,1);
    await assert.rejects(()=>recordBuyerReview(db,input,actor),/already recorded/);
    await revokeTicketAssociation(db,{
      company_id:company.id,ticket_id:ticket.id,expected_client_name:name,
      review_note:'Synthetic revocation to ensure old buyer source no longer qualifies.',
      confirmed:true
    },actor);
    const revoked=await readBuyerReview(db,prop.id,actor);
    assert.equal(revoked.linked_company,null);
    assert.equal(revoked.current.company_id,company.id,
      'Immutable historical documentary entry stays visible after revocation');
    await assert.rejects(()=>recordBuyerReview(db,{
      ...input,expected_revision:1
    },actor),/current reviewed CRM company association/);
  }finally{await db.end();}
});
