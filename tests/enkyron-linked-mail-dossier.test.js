import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {getCompanyDossier} from '../desktop/enkyron-crm-company-dossier.mjs';

const company='11111111-2222-4333-8444-555555555555';
const thread='22222222-3333-4444-8555-666666666666';

function fixture(mailRows=[]){
  const queries=[];
  const client={
    async query(sql,args=[]){
      queries.push({sql,args});
      if(sql.startsWith('BEGIN') || sql==='COMMIT' || sql==='ROLLBACK')
        return {rows:[]};
      if(sql.includes('FROM enkyron_crm_companies WHERE workspace_key=$1'))
        return {rows:[{id:company,name:'Capsule CRM'}]};
      if(sql.includes('FROM enkyron_mail_local_threads t'))
        return {rows:mailRows};
      return {rows:[]};
    },
    release(){}
  };
  return {queries,pool:{async connect(){return client;}}};
}

test('linked company mail appears as scoped reference without duplicating bodies',async()=>{
  const f=fixture([{
    mailbox:'direction',thread_id:thread,
    subject:'The hardest part of running a business?',
    last_message_at:'2026-11-14T23:09:00Z',folder_key:'inbox',
    total_rows:'1'
  }]);
  const result=await getCompanyDossier(f.pool,company,'emprex');
  assert.equal(result.available,true);
  assert.equal(result.sections.linked_mail.total,1);
  assert.equal(result.sections.linked_mail.items[0].thread_id,thread);
  assert.equal(result.sections.linked_mail.items[0].body_text,undefined);
  const query=f.queries.find(x=>x.sql.includes('FROM enkyron_mail_local_threads t'));
  assert.ok(query,'linked mail query executed');
  assert.deepEqual(query.args,['local:emprex',company]);
  assert.match(query.sql,/crm_company_id::text=\$2/);
  assert.match(query.sql,/can_read=true/);
  assert.match(query.sql,/organization_owner_l5/);
  assert.equal(f.queries.some(x=>/^\s*(?:INSERT|UPDATE|DELETE)\b/i.test(x.sql)),false);
});

test('empty linked mail section does not invent messages',async()=>{
  const f=fixture();
  const result=await getCompanyDossier(f.pool,company,'emprex');
  assert.deepEqual(result.sections.linked_mail,{total:0,items:[],more:false});
});

test('Qt dossier has a separate read-only Linked Mail panel and open action',()=>{
  const qt=readFileSync(new URL('../desktop/enkyron.py',import.meta.url),'utf8');
  assert.match(qt,/\("linked_mail", "Linked Mail"/);
  assert.match(qt,/crmDossierOpenLinkedMail/);
  assert.match(qt,/open_mail_thread_window\(/);
});
