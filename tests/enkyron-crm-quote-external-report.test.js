import test from 'node:test';
import assert from 'node:assert/strict';
import {validateQuoteExternalReport,readQuoteExternalReport,recordQuoteExternalReport}
  from '../desktop/enkyron-crm-quote-external-report.mjs';
const pid='11111111-2222-4333-8444-555555555555';
const rid='22222222-3333-4444-8555-666666666666';
const receiptId='33333333-4444-4555-8666-777777777777';
const review={
  proposal_id:pid,expected_revision:2,expected_source_review_id:rid,
  reported_reviewer_name:'Synthetic external reviewer',
  reported_reviewer_organisation:'Fictional reviewer',
  report_reference:'FICTIONAL-REPORT-2026-11-08',
  report_date:'2026-11-08',
  issuer_coverage:'not_addressed',buyer_coverage:'issues_reported',
  tax_coverage:'covered_in_report',report_outcome:'requires_changes',
  review_note:'Fictional reviewer metadata only; no independent authentication.',
  confirmed:true
};
test('only reported findings, never independent verification or approval',()=>{
  const ok=validateQuoteExternalReport(review);
  assert.equal(ok.report_outcome,'requires_changes');
  assert.equal('issue_authorised' in ok,false);
  for(const bad of [
    null,[],{}, {...review,confirmed:false},
    {...review,expected_revision:0},
    {...review,expected_source_review_id:'wrong'},
    {...review,report_outcome:'verified'},
    {...review,report_outcome:'issue_approved'},
    {...review,buyer_coverage:'identity_verified'},
    {...review,tax_coverage:'tax_determined'},
    {...review,reported_reviewer_name:'x'},
    {...review,report_reference:'x'},
    {...review,review_note:'short'},
    {...review,report_date:'2026-02-30'},
    {...review,reported_reviewer_name:'foo'+String.fromCharCode(0)}
  ])assert.throws(()=>validateQuoteExternalReport(bad),/CRM/);
});
function fixture({found=true,source='submitted_for_independent_review',sourceId=rid,
  recorded=false,revision=2}={}){
  const calls=[],existing=recorded?[{id:receiptId,source_review_id:rid,
    report_outcome:'requires_changes',reported_reviewer_name:'Synthetic reviewer'}]:[];
  const client={async query(sql,params){
    calls.push({sql,params});
    if(sql.includes('FROM enkyron_crm_proposal_drafts'))return {rows:found?[{
      id:pid,revision,title:'Synthetic proposal',currency:'GBP',amount_minor:'75000'
    }]:[]};
    if(sql.includes('FROM enkyron_crm_quote_evidence_reviews'))return {rows:source?[{
      id:sourceId,review_state:source
    }]:[]};
    if(sql.includes('FROM enkyron_crm_quote_external_reports'))
      return {rows:sql.includes('LIMIT 21')?existing:existing.map(x=>({id:x.id}))};
    return {rows:[]};
  },release(){calls.push({sql:'RELEASE'});}};
  return {calls,pool:{connect:async()=>client}};
}
test('read-only receipt gate checks the exact source and never issues a quote',async()=>{
  const x=fixture();
  const result=await readQuoteExternalReport(x.pool,pid,'operator');
  assert.equal(result.source_state,'submitted_for_independent_review');
  assert.equal(result.can_record,true);
  assert.equal(result.issue_authorised,false);
  assert.equal(result.can_issue,false);
  assert.equal(x.calls[0].sql,'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.deepEqual(x.calls[1].params,['local:operator',pid]);
  assert.equal(x.calls.at(-2).sql,'COMMIT');
  for(const source of ['needs_changes',null]){
    const denied=await readQuoteExternalReport(fixture({source}).pool,pid,'operator');
    assert.equal(denied.can_record,false);
  }
  assert.equal((await readQuoteExternalReport(fixture({recorded:true}).pool,pid,'operator')).can_record,false);
});
test('write fails closed for missing/submitted source mismatch, stale revision, duplicate',async()=>{
  for(const opts of [
    {source:'needs_changes'},{source:null},{sourceId:receiptId},
    {recorded:true},{revision:3}
  ]){
    const x=fixture(opts);
    await assert.rejects(()=>recordQuoteExternalReport(x.pool,review,'operator'),
      /requires latest submitted|already recorded|revision changed/);
    assert.equal(x.calls.at(-2).sql,'ROLLBACK');
    assert.ok(x.calls.every(c=>!c.sql.startsWith('INSERT')));
  }
  const foreign=fixture({found:false});
  await assert.rejects(()=>recordQuoteExternalReport(foreign.pool,review,'different'),/not found/);
  assert.deepEqual(foreign.calls[1].params,['local:different',pid]);
});
test('single receipt write is append-only, source-bound and explicitly non-authoritative',async()=>{
  const x=fixture();
  const result=await recordQuoteExternalReport(x.pool,review,'operator',{uuid:()=>receiptId});
  assert.equal(result.issue_authorised,false);
  assert.equal(result.can_issue,false);
  assert.match(result.notice,/not independently verified/);
  const insert=x.calls.find(x=>x.sql.startsWith('INSERT INTO enkyron_crm_quote_external_reports'));
  assert.deepEqual(insert.params.slice(0,5),
    [receiptId,'local:operator',pid,2,rid]);
  assert.equal(x.calls.at(-2).sql,'COMMIT');
  assert.equal(x.calls.at(-1).sql,'RELEASE');
  assert.ok(x.calls.every(x=>!/^(UPDATE|DELETE|ALTER)\s/i.test(x.sql)));
});
