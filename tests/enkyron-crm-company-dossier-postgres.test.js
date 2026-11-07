import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {createCompany,createContact} from '../desktop/enkyron-crm.mjs';
import {updateCompany,updateContact} from '../desktop/enkyron-crm-edit.mjs';
import {previewProspectLink,associateProspect} from '../desktop/enkyron-crm-link.mjs';
import {linkTicketToCompany} from '../desktop/enkyron-crm-tickets.mjs';
import {createOpportunity} from '../desktop/enkyron-crm-opportunities.mjs';
import {recordActivity} from '../desktop/enkyron-crm-activities.mjs';
import {createMailDraft} from '../desktop/enkyron-crm-mail-drafts.mjs';
import {getCompanyDossier} from '../desktop/enkyron-crm-company-dossier.mjs';

const url=process.env.ARL_CI_POSTGRES_URL||'';
function disposable(){
  assert.equal(process.env.CI,'true','Only disposable CI PostgreSQL may be written');
  const u=new URL(url);
  assert.equal(u.hostname,'127.0.0.1');
  assert.equal(u.pathname,'/arl_ci');
  assert.equal(u.username,'arl_ci');
  assert.equal(u.password,'synthetic-ci-only');
  return url;
}
test('PostgreSQL company 360 shows only manually linked records without rewriting sources', {
  skip:!url&&'Disposable synthetic PostgreSQL only',
  timeout:50000
},async()=>{
  const pool=new pg.Pool({connectionString:disposable(),max:3});
  const actor='ci-dossier-'+randomUUID().slice(0,8);
  try{
    const name='Synthetic dossier '+randomUUID().slice(0,8);
    const a=await createCompany(pool,{name,city:'London'},actor);
    const twin=await createCompany(pool,{name,city:'London',duplicate_review:{
      match_ids:[a.id],confirmed:true,
      review_note:'Separate synthetic CRM company to verify explicit dossier boundaries.'
    }},actor);
    const contact=await createContact(pool,{company_id:a.id,full_name:'Verified only as manually recorded',
      job_title:'Research',email:'ci-person@example.invalid'},actor);
    // 21 contacts in total: previews show 20, but counts do not lose a record.
    const vals=[],placeholders=[];
    for(let i=0;i<20;i++){
      const o=vals.length;
      vals.push(randomUUID(),'local:'+actor,a.id,'Synthetic contact '+i,actor);
      placeholders.push('('+Array.from({length:5},(_,j)=>'$'+(o+j+1)).join(',')+')');
    }
    await pool.query(
      'INSERT INTO enkyron_crm_contacts '
      +'(id,workspace_key,company_id,full_name,owner_local) VALUES '+placeholders.join(','),
      vals
    );
    const user='usr_dossier_'+randomUUID();
    await pool.query('INSERT INTO users(id,email,password_hash,created_at) VALUES($1,$2,$3,NOW())',
      [user,'ci-'+randomUUID()+'@example.invalid','synthetic']);
    const linkedProspect='lead_dossier_'+randomUUID(),otherProspect='lead_dossier_'+randomUUID();
    for(const [id,companyName] of [[linkedProspect,name],
      [otherProspect,'Completely unrelated research candidate']]){
      await pool.query(
        'INSERT INTO sales_prospects '
        +'(id,company_name,source,created_by,created_at,updated_at) '
        +'VALUES($1,$2,$3,$4,NOW(),NOW())',
        [id,companyName,'synthetic-ci',user]
      );
    }
    const sourceBefore=(await pool.query(
      'SELECT * FROM sales_prospects WHERE id=$1',[linkedProspect]
    )).rows[0];
    const preview=await previewProspectLink(pool,linkedProspect,actor);
    assert.equal(preview.available,true);
    const linked=await associateProspect(pool,{
      prospect_id:linkedProspect,source_digest:preview.source_digest,
      mode:'existing',company_id:a.id,reviewed:true,
      review_note:'Human-reviewed research association for isolated CI company.'
    },actor);
    assert.equal(linked.company_id,a.id);
    const linkedOpportunity=await createOpportunity(pool,{
      prospect_id:linkedProspect,company_name_at_review:name,
      next_action:'Review contract discussion before contact',
      due_date:'2026-11-20'
    },actor);
    await createOpportunity(pool,{
      prospect_id:otherProspect,
      company_name_at_review:'Completely unrelated research candidate',
      next_action:'Review unrelated prospect separately',
      due_date:'2026-11-20'
    },actor);
    await recordActivity(pool,{
      opportunity_id:linkedOpportunity.id,activity_type:'task_note',
      detail:'Manual note linked to one reviewed prospect company only.',
      reviewed:true
    },actor);
    await createMailDraft(pool,{
      opportunity_id:linkedOpportunity.id,recipient_email:'',
      subject:'Draft for linked opportunity',
      body_text:'This is not sent.'
    },actor);
    // Existing internal commercial document only; no signed contract or issue.
    const proposalId=randomUUID();
    await pool.query(
      'INSERT INTO enkyron_crm_proposal_drafts '
      +'(id,workspace_key,opportunity_id,title,scope_text,currency,amount_minor,'
      +'created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8)',
      [proposalId,'local:'+actor,linkedOpportunity.id,
       'Unaccepted synthetic proposal',
       'Synthetic scoped work for explicitly linked company; no customer approval.',
       'GBP',1000,actor]
    );
    const ticket=randomUUID();
    await pool.query(
      'INSERT INTO arl_workbench_tickets '
      +'(id,ticket_number,title,client_name,system_owner,target_kind,'
      +'target_reference,scope_text,assessor_name) '
      +"VALUES($1,$2,'Synthetic support request','Historical client label',"
      +"'Local synthetic','other','manual:dossier','Synthetic request','ci-dossier')",
      [ticket,'CI-DOSSIER-'+ticket]
    );
    await linkTicketToCompany(pool,{
      company_id:a.id,ticket_id:ticket,
      ticket_client_name_at_review:'Historical client label',
      review_note:'Manually reviewed the ticket and selected company identity.',
      reviewed:true
    },actor);
    // Distinct internal activity sources, linked only through the reviewed ticket.
    // Raw text deliberately contains a marker which must never enter the 360 view.
    const privateMarker='CONFIDENTIAL_DOSSIER_TEXT_NOT_FOR_COMPANY_SUMMARY';
    const eventId=randomUUID(),noteId=randomUUID();
    await pool.query(
      'INSERT INTO arl_workbench_ticket_events '
      +'(id,ticket_id,event_type,detail,actor) VALUES($1,$2,$3,$4,$5)',
      [eventId,ticket,'status_changed',privateMarker,actor]
    );
    await pool.query(
      'INSERT INTO arl_workbench_notes '
      +'(id,ticket_id,body,source_type,entered_by) VALUES($1,$2,$3,$4,$5)',
      [noteId,ticket,privateMarker,'manual',actor]
    );
    const dossier=await getCompanyDossier(pool,a.id,actor);
    assert.equal(dossier.available,true);
    assert.equal(dossier.company.relationship_state,'prospect');
    assert.deepEqual(Object.fromEntries(
      Object.entries(dossier.sections).map(([k,v])=>[k,v.total])
    ),{contacts:21,prospects:1,tickets:1,opportunities:1,qualifications:0,activities:1,drafts:1,commercial_docs:1,ticket_history:2,audit_events:4,audit_changes:0});
    assert.equal(dossier.sections.contacts.items.length,20);
    assert.equal(dossier.sections.contacts.more,true);
    assert.equal(dossier.sections.prospects.items[0].prospect_id,linkedProspect);
    assert.equal(dossier.sections.opportunities.items[0].opportunity_id,linkedOpportunity.id);
    assert.equal(dossier.sections.tickets.items[0].ticket_id,ticket);
    assert.equal(dossier.sections.drafts.items[0].subject,'Draft for linked opportunity');
    assert.equal(dossier.sections.commercial_docs.items[0].document_id,proposalId);
    assert.equal(dossier.sections.commercial_docs.items[0].proposal_id,proposalId);
    assert.equal(dossier.sections.commercial_docs.items[0].document_kind,'proposal_draft');
    assert.equal(dossier.sections.commercial_docs.items[0].status,'internal_unaccepted_draft');
    assert.equal(dossier.sections.activities.items[0].activity_type,'task_note');
    assert.deepEqual(new Set(dossier.sections.ticket_history.items.map(x=>x.source_id)),
      new Set([eventId,noteId]));
    assert.deepEqual(new Set(dossier.sections.ticket_history.items.map(x=>x.record_kind)),
      new Set(['ticket_event','internal_note']));
    assert.ok(dossier.sections.ticket_history.items.every(x=>x.ticket_id===ticket));
    assert.ok(!JSON.stringify(dossier.sections.ticket_history).includes(privateMarker),
      'Do not publish internal note bodies or event detail in company overview');
    const review='Synthetic correction reviewed against the originally entered source.';
    await updateCompany(pool,{
      id:a.id,expected_version:1,confirmed:true,review_note:review,
      name,legal_name:'',sector:'Research services',city:'London',country:'',website:''
    },actor);
    await updateContact(pool,{
      id:contact.id,company_id:a.id,expected_version:1,confirmed:true,
      review_note:review,full_name:'Verified only as manually recorded',
      job_title:'Updated researcher',email:'ci-person@example.invalid',phone:''
    },actor);
    const audited=await getCompanyDossier(pool,a.id,actor);
    assert.equal(audited.sections.audit_events.total,6);
    assert.equal(audited.sections.audit_changes.total,2);
    assert.deepEqual(audited.sections.audit_changes.items.map(x=>x.resource_kind).sort(),
      ['company','contact']);
    const auditText=JSON.stringify({
      events:audited.sections.audit_events,changes:audited.sections.audit_changes
    });
    assert.ok(!auditText.includes('ci-person@example.invalid'));
    assert.ok(!auditText.includes(review));
    const noAutoMatch=await getCompanyDossier(pool,twin.id,actor);
    assert.equal(noAutoMatch.sections.audit_events.total,1);
    assert.equal(noAutoMatch.sections.audit_changes.total,0);
    assert.ok(Object.entries(noAutoMatch.sections).filter(([id])=>
      !id.startsWith('audit_')).every(([,section])=>section.total===0),
      'Identical names must not imply common legal identity');
    await assert.rejects(()=>getCompanyDossier(pool,a.id,'ci-other-operator'),
      /not found in local workspace/);
    assert.deepEqual((await pool.query(
      'SELECT * FROM sales_prospects WHERE id=$1',[linkedProspect]
    )).rows[0],sourceBefore);
    assert.equal((await pool.query(
      'SELECT relationship_state FROM enkyron_crm_companies WHERE id=$1',[a.id]
    )).rows[0].relationship_state,'prospect',
    'Viewing and linking a company must never promote it to client');
  }finally{await pool.end();}
});
