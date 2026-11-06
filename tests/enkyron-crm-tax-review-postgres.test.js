import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {createOpportunity} from '../desktop/enkyron-crm-opportunities.mjs';
import {createProposalDraft} from '../desktop/enkyron-crm-proposals.mjs';
import {getTaxReviews,recordTaxReview} from '../desktop/enkyron-crm-tax-review.mjs';

const url=process.env.ARL_CI_POSTGRES_URL||'';
function disposable(){
  assert.equal(process.env.CI,'true','Only isolated CI database may be written');
  const u=new URL(url);
  assert.equal(u.hostname,'127.0.0.1');
  assert.equal(u.pathname,'/arl_ci');
  assert.equal(u.username,'arl_ci');
  assert.equal(u.password,'synthetic-ci-only');
  return url;
}
test('real PG international tax research: immutable, linked, no VAT calculation or source rewrite', {
  skip:!url&&'Isolated PostgreSQL CI only',timeout:60000
},async()=>{
  const pool=new pg.Pool({connectionString:disposable(),max:3});
  const actor='ci-tax-'+randomUUID().slice(0,8);
  try{
    const user='usr_tax_'+randomUUID(),lead='lead_tax_'+randomUUID();
    await pool.query(
      'INSERT INTO users(id,email,password_hash,created_at) VALUES($1,$2,$3,NOW())',
      [user,'ci-tax-'+randomUUID()+'@example.invalid','synthetic']);
    await pool.query(
      'INSERT INTO sales_prospects '
      +'(id,company_name,source,created_by,created_at,updated_at) '
      +'VALUES($1,$2,$3,$4,NOW(),NOW())',
      [lead,'Potential international services buyer','synthetic-ci',user]);
    const opp=await createOpportunity(pool,{
      prospect_id:lead,company_name_at_review:'Potential international services buyer',
      next_action:'Verify buyer identity and jurisdiction manually',
      due_date:'2026-11-20'
    },actor);
    const draft=await createProposalDraft(pool,{
      opportunity_id:opp.id,title:'Human-led agent security advisory',
      scope_text:'Manual advisory security service; scope requires client approval.',
      currency:'GBP',amount_minor:50000
    },actor);
    const proposalBefore=(await pool.query(
      'SELECT * FROM enkyron_crm_proposal_drafts WHERE id=$1',[draft.id]
    )).rows[0];
    const prospectBefore=(await pool.query(
      'SELECT * FROM sales_prospects WHERE id=$1',[lead]
    )).rows[0];
    const activityBefore=(await pool.query(
      'SELECT count(*)::int AS n FROM sales_messages'
    )).rows[0].n;
    const initial=await getTaxReviews(pool,draft.id,actor);
    assert.deepEqual(initial.items,[]);
    assert.equal(initial.proposal_revision,1);
    const result=await recordTaxReview(pool,{
      proposal_id:draft.id,expected_revision:1,
      buyer_type:'business',buyer_country:'FR',
      service_mode:'human_led_advisory',uk_vat_registration:'unknown',
      overseas_withholding:'not_checked',
      business_evidence:'Verified commercial register evidence for synthetic buyer',
      location_evidence:'Synthetic company office in France evidenced by registry',
      review_notes:'Human operator collected evidence; final VAT classification requires review.',
      source_reference:'HMRC VAT Notice 741A / EU VAT services guidance',
      confirmed:true
    },actor);
    assert.equal(result.proposal_revision,1);
    const second=await recordTaxReview(pool,{
      proposal_id:draft.id,expected_revision:1,
      buyer_type:'unknown',buyer_country:'',
      service_mode:'mixed_or_other',uk_vat_registration:'unknown',
      overseas_withholding:'potential_issue',
      business_evidence:'',
      location_evidence:'',
      review_notes:'Additional research required before any jurisdiction or tax treatment is concluded.',
      confirmed:true
    },actor);
    assert.ok(second.id!==result.id);
    const records=await getTaxReviews(pool,draft.id,actor);
    assert.equal(records.items.length,2);
    assert.ok(records.items.some(x=>x.buyer_country==='FR'));
    assert.ok(records.items.some(x=>x.buyer_type==='unknown'));
    assert.ok(records.items.every(x=>!('uk_vat_rate' in x)));
    assert.ok(records.items.every(x=>!('amount_due_minor' in x)));
    await assert.rejects(()=>getTaxReviews(pool,draft.id,'ci-another'),/not found/);
    await assert.rejects(()=>recordTaxReview(pool,{
      proposal_id:draft.id,expected_revision:1,buyer_type:'consumer',
      buyer_country:'US',service_mode:'automated_digital',
      uk_vat_registration:'unknown',overseas_withholding:'not_checked',
      location_evidence:'Recorded synthetic customer country as US with evidence',
      review_notes:'Another operator must not write to a foreign workspace proposal.',
      confirmed:true
    },'ci-another'),/not found/);
    await assert.rejects(()=>recordTaxReview(pool,{
      proposal_id:draft.id,expected_revision:99,buyer_type:'unknown',
      buyer_country:'',service_mode:'unknown',uk_vat_registration:'unknown',
      overseas_withholding:'not_checked',
      review_notes:'This outdated version must not be allowed to create another review.',
      confirmed:true
    },actor),/changed/);
    await assert.rejects(()=>pool.query(
      'UPDATE enkyron_crm_proposal_tax_reviews SET buyer_type=$1 WHERE id=$2',
      ['consumer',result.id]
    ),/cannot be changed or deleted/);
    await assert.rejects(()=>pool.query(
      'DELETE FROM enkyron_crm_proposal_tax_reviews WHERE id=$1',[result.id]
    ),/cannot be changed or deleted/);
    const count=(await pool.query(
      'SELECT count(*)::int AS n FROM enkyron_crm_proposal_tax_reviews WHERE proposal_id=$1',
      [draft.id]
    )).rows[0].n;
    assert.equal(count,2);
    assert.deepEqual((await pool.query(
      'SELECT * FROM enkyron_crm_proposal_drafts WHERE id=$1',[draft.id]
    )).rows[0],proposalBefore);
    assert.deepEqual((await pool.query(
      'SELECT * FROM sales_prospects WHERE id=$1',[lead]
    )).rows[0],prospectBefore);
    assert.equal((await pool.query(
      'SELECT count(*)::int AS n FROM sales_messages'
    )).rows[0].n,activityBefore);
  }finally{await pool.end();}
});
