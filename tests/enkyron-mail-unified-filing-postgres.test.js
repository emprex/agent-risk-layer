import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import pg from 'pg';
import {createCompany} from '../desktop/enkyron-crm.mjs';
import {linkTicketToCompany} from '../desktop/enkyron-crm-tickets.mjs';
import {previewUnifiedMailFiling,commitUnifiedMailFiling}
  from '../desktop/enkyron-mail-unified-filing.mjs';

const url=process.env.ARL_CI_POSTGRES_URL||'';
function disposableUrl(){
  assert.equal(process.env.CI,'true','Run only in disposable CI');
  const u=new URL(url);
  assert.equal(u.protocol,'postgresql:');
  assert.equal(u.hostname,'127.0.0.1');
  assert.equal(u.pathname,'/arl_ci');
  assert.equal(u.username,'arl_ci');
  assert.equal(u.password,'synthetic-ci-only');
  assert.equal(u.search,'');
  return url;
}
test('ENK-06 one approved filing: one company, one ticket, two dossier references, no duplicate bytes',{
  skip:!url && 'Disposable PostgreSQL CI only'
},async()=>{
  const pool=new pg.Pool({connectionString:disposableUrl(),max:3});
  const actor='ci-unified-'+randomUUID().slice(0,8);
  const workspace='local:'+actor;
  const companyName='Synthetic Unified Filing '+actor;
  const rationale='The operator reviewed this synthetic message, attachment, client and existing ticket.';
  try{
    const company=await createCompany(pool,{name:companyName},actor);
    const ticketId=randomUUID();
    const number='CI-UNIFIED-'+ticketId.slice(0,12);
    await pool.query(
      'INSERT INTO arl_workbench_tickets '+
      '(id,ticket_number,title,client_name,system_owner,target_kind,'+
      'target_reference,scope_text,assessor_name) '+
      "VALUES($1,$2,'Synthetic unified filing ticket',$3,"+
      "'CI owner','other','synthetic:unified-mail-filing',"+
      "'Synthetic CI authority only','CI analyst')",
      [ticketId,number,companyName]
    );
    await linkTicketToCompany(pool,{
      company_id:company.id,ticket_id:ticketId,
      ticket_client_name_at_review:companyName,
      review_note:rationale,reviewed:true
    },actor);
    await pool.query(
      'INSERT INTO enkyron_local_mail_access '+
      '(workspace_key,mailbox_key,role,can_read,can_send,granted_by) '+
      "VALUES($1,'direction','organization_owner_l5',true,false,$2)",
      [workspace,actor]
    );
    const thread=randomUUID(),message=randomUUID(),attachment=randomUUID();
    await pool.query(
      'INSERT INTO enkyron_mail_local_threads '+
      '(workspace_key,mailbox_key,thread_id,folder_key,subject) '+
      "VALUES($1,'direction',$2,'inbox','Synthetic CI email')",
      [workspace,thread]
    );
    await pool.query(
      'INSERT INTO enkyron_mail_local_messages '+
      '(workspace_key,mailbox_key,thread_id,message_id,subject) '+
      "VALUES($1,'direction',$2,$3,'Synthetic CI email')",
      [workspace,thread,message]
    );
    const bytes=Buffer.from('Synthetic test document in unscanned quarantine');
    const sha=createHash('sha256').update(bytes).digest('hex');
    await pool.query(
      'INSERT INTO enkyron_mail_attachment_quarantine '+
      '(workspace_key,mailbox_key,message_id,attachment_id,'+
      'original_filename,declared_size,content_bytes,content_sha256,safety_state) '+
      "VALUES($1,'direction',$2,$3,'ci-report.txt',$4,$5,$6,'quarantined_unscanned')",
      [workspace,message,attachment,bytes.length,bytes,sha]
    );
    const request={mailbox:'direction',thread_id:thread,company_id:company.id,
      company_name_at_review:companyName,
      ticket:{ticket_id:ticketId,ticket_number_at_review:number,
        client_name_at_review:companyName},
      attachment:{message_id:message,attachment_id:attachment,
        content_sha256_at_review:sha,destinations:['company','ticket']},
      review_note:rationale,confirmed:true};

    const plan=await previewUnifiedMailFiling(pool,actor,request);
    assert.equal(plan.company.status,'will_link');
    assert.equal(plan.ticket.status,'will_link');
    assert.equal(plan.attachment.sha256,sha);
    const stored=await commitUnifiedMailFiling(pool,actor,request);
    assert.equal(stored.saved,true);
    assert.equal(stored.safety_state,'quarantined_unscanned');
    assert.equal(stored.entries.company,'linked');
    assert.equal(stored.entries.ticket,'linked');
    assert.deepEqual(stored.entries.documents.map(x=>x.status),['linked','linked']);

    const threadRow=(await pool.query(
      'SELECT crm_company_id::text AS company_id FROM enkyron_mail_local_threads '+
      'WHERE workspace_key=$1 AND thread_id=$2',[workspace,thread]
    )).rows[0];
    assert.equal(threadRow.company_id,company.id);
    const ticketRows=(await pool.query(
      'SELECT ticket_id FROM enkyron_mail_ticket_links '+
      'WHERE workspace_key=$1 AND thread_id=$2',[workspace,thread]
    )).rows;
    assert.deepEqual(ticketRows.map(x=>x.ticket_id),[ticketId]);
    const documentRows=(await pool.query(
      'SELECT company_id,ticket_id,content_sha256_at_review '+
      'FROM enkyron_mail_document_dossier_links '+
      'WHERE workspace_key=$1 AND message_id=$2',[workspace,message]
    )).rows;
    assert.equal(documentRows.length,2);
    assert.ok(documentRows.every(x=>x.content_sha256_at_review===sha));
    const quarantine=(await pool.query(
      'SELECT safety_state,content_sha256,octet_length(content_bytes) AS n '+
      'FROM enkyron_mail_attachment_quarantine '+
      'WHERE workspace_key=$1 AND message_id=$2',[workspace,message]
    )).rows[0];
    assert.equal(quarantine.safety_state,'quarantined_unscanned');
    assert.equal(quarantine.content_sha256,sha);
    assert.equal(quarantine.n,bytes.length);
    const again=await commitUnifiedMailFiling(pool,actor,request);
    assert.equal(again.entries.company,'already_linked');
    assert.equal(again.entries.ticket,'already_linked');
    assert.ok(again.entries.documents.every(x=>x.status==='already_linked'));
  }finally{await pool.end();}
});
