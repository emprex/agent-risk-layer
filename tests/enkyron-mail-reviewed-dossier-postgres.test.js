import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import pg from 'pg';
import {createCompany} from '../desktop/enkyron-crm.mjs';
import {linkTicketToCompany} from '../desktop/enkyron-crm-tickets.mjs';
import {fileReviewedMailDossier} from '../desktop/enkyron-mail-reviewed-dossier.mjs';
import {SYNTHETIC_SEED_READBACK_SQL} from '../scripts/enkyron-enk06-uat-launch.mjs';
import {SYNTHETIC_IDS} from '../scripts/enkyron-enk06-uat-seed.mjs';

const raw=process.env.ARL_CI_POSTGRES_URL||'';
function disposable(){
  assert.equal(process.env.CI,'true','Disposable CI PostgreSQL only');
  const u=new URL(raw);
  assert.equal(u.protocol,'postgresql:');
  assert.equal(u.hostname,'127.0.0.1');
  assert.equal(u.pathname,'/arl_ci');
  assert.equal(u.username,'arl_ci');
  assert.equal(u.password,'synthetic-ci-only');
  return raw;
}
test('reviewed Mail + one quarantined document + existing ticket: atomic synthetic PostgreSQL roundtrip',{
  skip:!raw&&'Disposable PostgreSQL CI only',timeout:60000
},async()=>{
  const pool=new pg.Pool({connectionString:disposable(),max:3});
  const actor='ci-dossier-'+randomUUID().slice(0,8),workspace='local:'+actor;
  const thread_id=randomUUID(),message_id=randomUUID(),attachment_id=randomUUID();
  const ticket_id=randomUUID(),ticket_number='CI-ENK06-'+ticket_id.slice(0,8);
  const client_name='Synthetic Louvain Engine';
  const reason='Explicitly reviewed synthetic ENK-06 Mail classification into existing dossiers.';
  const bytes=Buffer.from('synthetic controlled offline proof bytes','utf8');
  const hash=createHash('sha256').update(bytes).digest('hex');
  try{
    const table=(await pool.query(
      "SELECT to_regclass('public.enkyron_mail_document_dossier_links') AS docs, "+
      "to_regclass('public.enkyron_mail_ticket_links') AS tickets"
    )).rows[0];
    assert.ok(table.docs&&table.tickets,'Migrations 116/117 required on disposable CI DB');

    const company=await createCompany(pool,{
      name:'Synthetic Louvain AI '+actor
    },actor);
    await pool.query(
      'INSERT INTO arl_workbench_tickets '+
      '(id,ticket_number,title,client_name,system_owner,target_kind,'+
      'target_reference,scope_text,assessor_name) '+
      "VALUES($1,$2,'CI ENK-06 document ticket',$3,'CI owner','other',"+
      "'synthetic:enk06','Synthetic restricted scope','CI reviewer')",
      [ticket_id,ticket_number,client_name]
    );
    await linkTicketToCompany(pool,{
      company_id:company.id,ticket_id,
      ticket_client_name_at_review:client_name,review_note:reason,reviewed:true
    },actor);
    await pool.query(
      'INSERT INTO enkyron_local_mail_access '+
      '(workspace_key,mailbox_key,role,can_read,can_send,granted_by) '+
      "VALUES($1,'direction','organization_owner_l5',true,false,$2)",
      [workspace,actor]
    );
    await pool.query(
      'INSERT INTO enkyron_mail_local_threads '+
      '(workspace_key,mailbox_key,thread_id,folder_key,subject,crm_company_id) '+
      "VALUES($1,'direction',$2,'inbox','CI synthetic dossier email',$3)",
      [workspace,thread_id,company.id]
    );
    await pool.query(
      'INSERT INTO enkyron_mail_local_messages '+
      '(workspace_key,mailbox_key,thread_id,message_id) '+
      "VALUES($1,'direction',$2,$3)",
      [workspace,thread_id,message_id]
    );
    await pool.query(
      'INSERT INTO enkyron_mail_attachment_quarantine '+
      '(workspace_key,mailbox_key,message_id,attachment_id,original_filename,'+
      'content_bytes,content_sha256,safety_state,declared_size) '+
      "VALUES($1,'direction',$2,$3,'synthetic.pdf',$4,$5,'quarantined_unscanned',$6)",
      [workspace,message_id,attachment_id,bytes,hash,bytes.length]
    );
    const request={
      mailbox:'direction',thread_id,company_id:company.id,
      company_name_at_review:company.name,
      ticket_id,ticket_number_at_review:ticket_number,
      client_name_at_review:client_name,
      message_id,attachment_id,filename_at_review:'synthetic.pdf',
      review_note:reason,confirmed:true
    };
    const first=await fileReviewedMailDossier(pool,actor,request);
    assert.equal(first.verified,true);
    assert.deepEqual(first.created,{
      company_document:true,ticket_document:true,mail_ticket:true
    });
    const existing=await fileReviewedMailDossier(pool,actor,request);
    assert.deepEqual(existing.created,{
      company_document:false,ticket_document:false,mail_ticket:false
    });
    const doc=(await pool.query(
      'SELECT company_id,ticket_id,content_sha256_at_review FROM '+
      'enkyron_mail_document_dossier_links WHERE workspace_key=$1',
      [workspace])).rows;
    assert.equal(doc.length,2);
    assert.ok(doc.every(d=>d.content_sha256_at_review===hash));
    assert.ok(doc.some(d=>d.company_id===company.id&&!d.ticket_id));
    assert.ok(doc.some(d=>d.ticket_id===ticket_id&&!d.company_id));
    const ticket=(await pool.query(
      'SELECT count(*)::int AS n FROM enkyron_mail_ticket_links '+
      'WHERE workspace_key=$1 AND thread_id=$2',
      [workspace,thread_id])).rows[0];
    assert.equal(ticket.n,1);

    // Server rejects forged client/ticket pairing before inserting anything.
    await assert.rejects(
      fileReviewedMailDossier(pool,actor,{
        ...request,company_name_at_review:'Other company'
      }),/company changed/i
    );
    const after=(await pool.query(
      'SELECT count(*)::int AS n FROM enkyron_mail_document_dossier_links '+
      'WHERE workspace_key=$1',[workspace])).rows[0];
    assert.equal(after.n,2);
    const q=(await pool.query(
      'SELECT safety_state,content_sha256 FROM enkyron_mail_attachment_quarantine '+
      'WHERE workspace_key=$1 AND attachment_id=$2',
      [workspace,attachment_id])).rows[0];
    assert.equal(q.safety_state,'quarantined_unscanned');
    assert.equal(q.content_sha256,hash);

    // Real database rollback after a successful first INSERT. Force the same
    // link_id for the second destination: ON CONFLICT must not manufacture a
    // partial success. Exact readback rejects it and ROLLBACK removes the
    // first, previously inserted company-document link as well.
    const second_message_id=randomUUID(),second_attachment_id=randomUUID();
    await pool.query(
      'INSERT INTO enkyron_mail_local_messages '+
      '(workspace_key,mailbox_key,thread_id,message_id) '+
      "VALUES($1,'direction',$2,$3)",
      [workspace,thread_id,second_message_id]
    );
    await pool.query(
      'INSERT INTO enkyron_mail_attachment_quarantine '+
      '(workspace_key,mailbox_key,message_id,attachment_id,original_filename,'+
      'content_bytes,content_sha256,safety_state,declared_size) '+
      "VALUES($1,'direction',$2,$3,'rollback-proof.pdf',$4,$5,'quarantined_unscanned',$6)",
      [workspace,second_message_id,second_attachment_id,bytes,hash,bytes.length]
    );
    const unsafe={...request,message_id:second_message_id,
      attachment_id:second_attachment_id,filename_at_review:'rollback-proof.pdf'};
    const reusedLinkId=randomUUID();
    await assert.rejects(
      fileReviewedMailDossier(pool,actor,unsafe,{uuid:()=>reusedLinkId}),
      /exact readback/i
    );
    const partial=(await pool.query(
      'SELECT count(*)::int AS n FROM enkyron_mail_document_dossier_links '+
      'WHERE workspace_key=$1 AND attachment_id=$2',
      [workspace,second_attachment_id]
    )).rows[0];
    assert.equal(partial.n,0,'ROLLBACK must undo the first successful INSERT');
    const stable=(await pool.query(
      'SELECT count(*)::int AS n FROM enkyron_mail_ticket_links '+
      'WHERE workspace_key=$1 AND thread_id=$2',
      [workspace,thread_id]
    )).rows[0];
    assert.equal(stable.n,1,'Earlier committed canonical link must remain intact');

    // Even when bytes are present, a blocked attachment is never linkable.
    await pool.query(
      "UPDATE enkyron_mail_attachment_quarantine SET safety_state='blocked' "+
      'WHERE workspace_key=$1 AND attachment_id=$2',
      [workspace,second_attachment_id]
    );
    await assert.rejects(
      fileReviewedMailDossier(pool,actor,unsafe),
      /securely quarantined/i
    );
    const blocked=(await pool.query(
      'SELECT count(*)::int AS n FROM enkyron_mail_document_dossier_links '+
      'WHERE workspace_key=$1 AND attachment_id=$2',
      [workspace,second_attachment_id]
    )).rows[0];
    assert.equal(blocked.n,0);
  }finally{
    await pool.end();
  }
});

test('ENK-06 native launcher preflight SQL parses against actual PostgreSQL UUID/TEXT columns',{
  skip:!raw&&'Disposable PostgreSQL CI only',timeout:30000
},async()=>{
  // No fixture mutation. PostgreSQL prepares the real readback SQL, including
  // all its mixed UUID and TEXT comparison operators, without running it.
  const pool=new pg.Pool({connectionString:disposable(),max:1});
  try{
    const actor='ci-readback',key='local:'+actor;
    const ids=SYNTHETIC_IDS;
    const params=[key,ids.company_id,
      'ENK06 Synthetic Demo Company — NOT REAL',
      ids.ticket_id,ids.thread_id,ids.attachment_id,ids.message_id];
    const explained=await pool.query(
      'EXPLAIN '+SYNTHETIC_SEED_READBACK_SQL,params
    );
    assert.ok(explained.rows.length>0);
    assert.match(SYNTHETIC_SEED_READBACK_SQL,/crm_company_id::text=\$2/);
  }finally{await pool.end();}
});
