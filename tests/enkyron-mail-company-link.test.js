import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateMailCompanyLink,localMailCompanyLink,linkLocalMailCompany
} from '../desktop/enkyron-mail-local.mjs';

const thread='11111111-2222-4333-8444-555555555555';
const company='22222222-3333-4333-8444-666666666666';
const alternate='33333333-4444-4555-8666-777777777777';
const valid={mailbox:'direction',thread_id:thread,company_id:company,confirmed:true};

test('company association requires explicit selection, real IDs and confirmation',()=>{
  assert.deepEqual(validateMailCompanyLink(valid),{
    mailbox:'direction',thread,company
  });
  for(const bad of [
    {...valid,confirmed:false},{...valid,confirmed:'yes'},
    {...valid,company_id:undefined},{...valid,company_id:'incorrect'},
    {...valid,thread_id:'bad'},{...valid,mailbox:'all'}
  ])assert.throws(()=>validateMailCompanyLink(bad));
});

function mock({permission=true,existing=null,folder='inbox',target=true}={}){
  const logs=[],state={company:existing},owner='local:operator';
  const query=async(sql,args)=>{
    logs.push({sql,args});
    if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return {rows:[]};
    if(sql.startsWith('SELECT can_read FROM enkyron_local_mail_access'))
      return {rows:permission?[{can_read:true}]:[]};
    if(sql.startsWith('SELECT crm_company_id,folder_key FROM enkyron_mail_local_threads'))
      return {rows:[{crm_company_id:state.company,folder_key:folder}]};
    if(sql.startsWith('SELECT id,name,relationship_state FROM enkyron_crm_companies'))
      return {rows:target?[{id:company,name:'Example Client',relationship_state:'prospect'}]:[]};
    if(sql.startsWith('UPDATE enkyron_mail_local_threads SET crm_company_id=')){
      if(state.company!==null)return {rowCount:0,rows:[]};
      state.company=args[3];
      return {rowCount:1,rows:[{crm_company_id:state.company}]};
    }
    if(sql.startsWith('SELECT t.crm_company_id AS company_id')){
      return {rows:[{company_id:state.company,
        company_name:state.company?'Example Client':null,folder_key:folder}]};
    }
    throw Error('Unexpected DB statement '+sql);
  };
  const pool={query,connect:async()=>({query,release(){}})};
  return {pool,logs,state,owner};
}

test('human reviewed company link changes one local thread and never touches Resend',async()=>{
  const h=mock();
  const previous=await localMailCompanyLink(h.pool,'operator',valid);
  assert.equal(previous.linked,false);
  const result=await linkLocalMailCompany(h.pool,'operator',valid);
  assert.equal(result.linked,true);
  assert.equal(result.company_id,company);
  assert.equal(result.provider_unchanged,true);
  assert.equal(h.state.company,company);
  const linked=await localMailCompanyLink(h.pool,'operator',valid);
  assert.equal(linked.linked,true);
  assert.equal(linked.company_name,'Example Client');
  assert.equal(h.logs.filter(x=>x.sql.startsWith('UPDATE ')).length,1);
  assert.ok(h.logs.every(x=>!/(api\.resend\.com|DELETE FROM|INSERT INTO)/i.test(x.sql)));
  assert.deepEqual(h.logs.find(x=>x.sql.startsWith('UPDATE ')).args,[
    h.owner,'direction',thread,company
  ]);
  await assert.rejects(linkLocalMailCompany(h.pool,'operator',{
    ...valid,company_id:alternate
  }),/already linked/);
  assert.equal(h.logs.filter(x=>x.sql.startsWith('UPDATE ')).length,1);
});

test('unverified, inaccessible, spam and unavailable associations fail closed',async()=>{
  const situations=[
    [{permission:false},/permission/],
    [{folder:'spam'},/spam\/trash/],
    [{folder:'trash'},/spam\/trash/],
    [{target:false},/unavailable/],
    [{existing:alternate},/already linked/]
  ];
  for(const [config,reason] of situations){
    const h=mock(config);
    await assert.rejects(linkLocalMailCompany(h.pool,'operator',valid),reason);
    assert.equal(h.logs.some(x=>x.sql.startsWith('UPDATE ')),false);
    assert.equal(h.logs.at(-1).sql,'ROLLBACK');
  }
  const h=mock({permission:false});
  await assert.rejects(localMailCompanyLink(h.pool,'operator',valid),/permission/);
  assert.equal(h.logs.some(x=>x.sql.includes('JOIN enkyron_crm_companies')),false);
});
