import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateDraftCreate,validateDraftUpdate,listMailDrafts,readMailDraft,
  createMailDraft,updateMailDraft
} from '../desktop/enkyron-crm-mail-drafts.mjs';

const opportunityId='11111111-2222-4333-8444-555555555555';
const draftId='22222222-3333-4444-8555-666666666666';
const content={opportunity_id:opportunityId,recipient_email:'',
  subject:'A manual proposal',body_text:'Hello,\nHere is the proposed scope.'};

test('drafts require at least one content field and never auto-fill recipients',()=>{
  assert.deepEqual(validateDraftCreate(content),{...content,company_id:null,mailbox_key:'direction'});
  const companyId='33333333-4444-4555-8666-777777777777';
  assert.equal(validateDraftCreate({
    company_id:companyId,recipient_email:'',subject:'Internal research',body_text:''
  }).company_id,companyId);
  assert.throws(()=>validateDraftCreate({...content,company_id:companyId}),/two CRM records/);
  assert.equal(validateDraftCreate({...content,recipient_email:'  '}).recipient_email,'');
  assert.equal(validateDraftCreate({...content,recipient_email:'person@example.invalid'}).recipient_email,
    'person@example.invalid');
  for(const bad of [
    null,[],{}, {...content,opportunity_id:'bad'},
    {...content,subject:'',body_text:''},
    {...content,recipient_email:'a@example.invalid,b@example.invalid'},
    {...content,recipient_email:'name\nbcc@example.invalid'},
    {...content,recipient_email:'missing-at-sign'},
    {...content,subject:'test\nBcc: bad@example.invalid'},
    {...content,body_text:'\u0000bad'},
    {...content,subject:'S'.repeat(201)},
    {...content,body_text:'x'.repeat(20001)}
  ])assert.throws(()=>validateDraftCreate(bad),/CRM/);
  assert.equal(validateDraftUpdate({...content,id:draftId,expected_revision:1}).id,draftId);
  for(const bad of [
    {...content,id:'bad',expected_revision:1},
    {...content,id:draftId,expected_revision:0},
    {...content,id:draftId,expected_revision:'1'}
  ])assert.throws(()=>validateDraftUpdate(bad),/CRM/);
});

test('draft list and detail read are bounded, parameterized and scoped',async()=>{
  const queries=[];
  const db={query:async(sql,params)=>{
    queries.push({sql,params});
    return {rows:sql.includes('SELECT d.id,d.opportunity_id,d.company_id,d.mailbox_key,d.recipient_email,d.subject,d.body_text')?
      [{id:draftId,body_text:'Private draft',revision:1}]:[]};
  }};
  const list=await listMailDrafts(db,'  hello  ','ci-operator');
  assert.equal(list.available,true);
  assert.deepEqual(list.items,[]);
  assert.deepEqual(queries[0].params,['local:ci-operator','hello']);
  assert.match(queries[0].sql,/LIMIT 101/);
  assert.ok(!queries[0].sql.includes('d.body_text'));
  const draft=await readMailDraft(db,draftId,'ci-operator');
  assert.equal(draft.draft.body_text,'Private draft');
  assert.deepEqual(queries[1].params,['local:ci-operator',draftId]);
  await assert.rejects(()=>readMailDraft(db,"' OR TRUE",'ci-operator'),/CRM/);
  const missing={query:async()=>{const err=new Error('missing');err.code='42P01';throw err;}};
  assert.equal((await listMailDrafts(missing,'','ci-operator')).available,false);
  assert.equal((await readMailDraft(missing,draftId,'ci-operator')).available,false);
});

test('creating draft inserts content and hashed metadata atomically',async()=>{
  const queries=[];
  const ids=[draftId,'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'];
  let released=false;
  const pool={connect:async()=>({
    query:async(sql,params)=>{
      queries.push({sql,params});
      if(sql.includes('FROM enkyron_crm_opportunities'))return {rows:[{id:opportunityId}]};
      return {rows:[]};
    },release:()=>{released=true;}
  })};
  const out=await createMailDraft(pool,content,'ci-operator',{uuid:()=>ids.shift()});
  assert.equal(out.id,draftId);
  assert.equal(out.revision,1);
  assert.deepEqual(queries.map(q=>q.sql.match(/^[A-Z]+/)[0]),
    ['BEGIN','SELECT','INSERT','INSERT','COMMIT']);
  const record=queries[2];
  assert.equal(record.params[1],'local:ci-operator');
  assert.equal(record.params[3],null);
  assert.equal(record.params[4],'direction');
  assert.equal(record.params[5],null);
  assert.equal(record.params[7],content.body_text);
  const event=queries[3];
  assert.match(event.params[3],/^[a-f0-9]{64}$/);
  assert.ok(!event.params.includes(content.body_text));
  assert.equal(released,true);
});

test('stale revisions and missing ownership rollback before modifying content',async()=>{
  for(const kind of ['missing','stale','unchanged']){
    const statements=[];
    const pool={connect:async()=>({
      query:async(sql)=>{
        statements.push(sql);
        if(sql.includes('FROM enkyron_crm_mail_drafts')){
          if(kind==='missing')return {rows:[]};
          return {rows:[{id:draftId,revision:kind==='stale'?2:1,
            subject:'Same',body_text:'Same text',recipient_email:null}]};
        }
        return {rows:[]};
      },release:()=>{}
    })};
    const data={id:draftId,expected_revision:1,
      subject:kind==='unchanged'?'Same':'Other',body_text:kind==='unchanged'?'Same text':'Other text',
      recipient_email:''};
    await assert.rejects(()=>updateMailDraft(pool,data,'ci-operator'),/CRM/);
    assert.equal(statements.at(-1),'ROLLBACK');
    assert.ok(!statements.some(x=>x.startsWith('UPDATE ')));
  }
});

test('updating draft increments revision and hashes audit without leaking body',async()=>{
  const statements=[];
  const pool={connect:async()=>({
    query:async(sql,params)=>{
      statements.push({sql,params});
      if(sql.startsWith('SELECT id,mailbox_key,recipient_email'))return {rows:[{
        id:draftId,recipient_email:null,subject:'Original',body_text:'Old text',revision:1
      }]};
      if(sql.startsWith('UPDATE enkyron_crm_mail_drafts'))return {
        rows:[{id:draftId,revision:2}]
      };
      return {rows:[]};
    },release:()=>{}
  })};
  const next={id:draftId,expected_revision:1,
    recipient_email:'customer@example.invalid',subject:'Revised proposal',
    body_text:'Carefully reviewed manual outreach text'};
  const result=await updateMailDraft(pool,next,'ci-operator',{
    uuid:()=> 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
  });
  assert.equal(result.revision,2);
  assert.deepEqual(statements.map(q=>q.sql.match(/^[A-Z]+/)[0]),
    ['BEGIN','SELECT','UPDATE','INSERT','COMMIT']);
  assert.equal(statements[2].params[5],2);
  assert.equal(statements[2].params[7],1);
  assert.match(statements[3].params[4],/^[a-f0-9]{64}$/);
  assert.ok(!statements[3].params.includes(next.body_text));
});


test('Mail Drafts excludes provider submissions and external sends at SQL source',async()=>{
  const logs=[];
  const db={query:async(sql,params)=>{
    logs.push({sql,params});
    return {rows:[{
      id:draftId,mailbox_key:'direction',subject:'Still unsent',
      mail_state:'draft',revision:1
    }]};
  }};
  const unsent=await listMailDrafts(db,'  hello  ','ci-operator',{unsentOnly:true});
  assert.equal(unsent.kind,'unsent_mail_drafts');
  assert.deepEqual(unsent.items.map(row=>row.mail_state),['draft']);
  assert.match(logs[0].sql,/WHERE d\.workspace_key=\$1\s+AND a\.id IS NULL AND s\.id IS NULL/);
  assert.match(logs[0].sql,/LEFT JOIN enkyron_mail_send_attempts a/);
  assert.match(logs[0].sql,/LEFT JOIN enkyron_crm_mail_manual_sends s/);
  assert.match(logs[0].sql,/LIMIT 101/);
  assert.ok(!logs[0].sql.includes('d.body_text'));
  assert.deepEqual(logs[0].params,['local:ci-operator','hello']);
  await listMailDrafts(db,'','ci-operator');
  assert.ok(!logs[1].sql.includes('AND a.id IS NULL AND s.id IS NULL'));
  assert.equal(logs[1].sql.includes('LEFT JOIN enkyron_mail_send_attempts a'),true);
  await assert.rejects(listMailDrafts(db,'','ci-operator',{unsentOnly:'yes'}),
    /CRM invalid draft list mode/);
});
