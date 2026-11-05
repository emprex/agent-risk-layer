import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateCompany,validateContact,listCompanies,listContacts,
  createCompany,createContact
} from '../desktop/enkyron-crm.mjs';

const companyId='11111111-2222-4333-8444-555555555555';
const contactId='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

test('company creation requires a real name and starts as an unverified prospect',()=>{
  const item=validateCompany({name:'  Acme Ltd  ',website:'https://example.invalid/about'});
  assert.equal(item.name,'Acme Ltd');
  assert.equal(item.website,'https://example.invalid/about');
  for(const input of [
    {name:' '},{name:'A'.repeat(161)},
    {name:'Acme',relationship_state:'client'},
    {name:'Acme',website:'javascript:alert(1)'},
    {name:'Acme',website:'https://user:pw@example.invalid'},
    {name:'Acme\nInjected'}
  ])assert.throws(()=>validateCompany(input),/CRM/);
});

test('contact must belong to an identified company; unknown marketing permission by default',()=>{
  assert.equal(validateContact({company_id:companyId,full_name:'  Alice  '}).full_name,'Alice');
  for(const input of [
    {company_id:'bad',full_name:'Alice'},
    {company_id:companyId,full_name:' '},
    {company_id:companyId,full_name:'Alice',email:'not-an-email'},
    {company_id:companyId,full_name:'Alice',marketing_permission:'opt_in'},
  ])assert.throws(()=>validateContact(input),/CRM/);
});

test('company and contact listing are bounded and workspace scoped',async()=>{
  const queries=[];
  const pool={query:async(sql,params)=>{
    queries.push([sql,params]);
    if(sql.includes('SELECT id,name FROM enkyron_crm_companies')){
      return {rows:[{id:companyId,name:'Acme'}]};
    }
    return {rows:[]};
  }};
  const companies=await listCompanies(pool,'  acme  ','ci-operator');
  assert.equal(companies.available,true);
  assert.deepEqual(queries[0][1],['local:ci-operator','acme']);
  assert.match(queries[0][0],/LIMIT 101/);
  const contacts=await listContacts(pool,companyId,'ci-operator');
  assert.equal(contacts.items.length,0);
  assert.deepEqual(queries[1][1],[companyId,'local:ci-operator']);
  assert.deepEqual(queries[2][1],[companyId,'local:ci-operator']);
  await assert.rejects(()=>listCompanies(pool,'X'.repeat(101),'ci-operator'),/100 characters/);
  await assert.rejects(()=>listContacts(pool,"x' OR 1=1",'ci-operator'),/CRM/);
});

test('CRM is explicit when schema is absent and never suppresses other DB errors',async()=>{
  const db={query:async()=>{const e=new Error('missing');e.code='42P01';throw e;}};
  const result=await listCompanies(db,'','ci-operator');
  assert.equal(result.available,false);
  assert.match(result.notice,/065/);
  await assert.rejects(()=>listCompanies({
    query:async()=>{throw new Error('Permission denied');}
  },'','ci-operator'),/Permission denied/);
});

test('transaction creates company and event under the same operator, or rolls back',async()=>{
  const calls=[];
  const db={
    connect:async()=>({
      query:async(sql,params)=>{
        calls.push({sql,params});
        return {rows:[]};
      },
      release:()=>{calls.push({sql:'RELEASE'});}
    })
  };
  const ids=[companyId,contactId];
  const out=await createCompany(db,{name:'Example'},'ci-operator',{uuid:()=>ids.shift()});
  assert.equal(out.relationship_state,'prospect');
  assert.equal(out.id,companyId);
  assert.equal(calls[0].sql,'BEGIN');
  assert.match(calls[1].sql,/INSERT INTO enkyron_crm_companies/);
  assert.equal(calls[1].params[1],'local:ci-operator');
  assert.match(calls[2].sql,/INSERT INTO enkyron_crm_events/);
  assert.equal(calls[3].sql,'COMMIT');
  const failing={
    connect:async()=>({
      query:async sql=>{
        if(sql.includes('INSERT INTO enkyron_crm_events'))throw new Error('event unavailable');
        return {rows:[]};
      },release:()=>{}
    })
  };
  await assert.rejects(
    ()=>createCompany(failing,{name:'Example'},'ci-operator',{uuid:()=>companyId}),
    /event unavailable/
  );
});

test('contact creation refuses cross-scope company before any insert',async()=>{
  const seen=[];
  const pool={
    connect:async()=>({
      query:async(sql,params)=>{
        seen.push({sql,params});
        return {rows:[]};
      },release:()=>{}
    })
  };
  await assert.rejects(
    ()=>createContact(pool,{company_id:companyId,full_name:'Alice'},'ci-operator'),
    /CRM company not found/
  );
  assert.deepEqual(seen.map(x=>x.sql),[
    'BEGIN',
    'SELECT id FROM enkyron_crm_companies WHERE id=$1 AND workspace_key=$2 FOR KEY SHARE',
    'ROLLBACK'
  ]);
  assert.deepEqual(seen[1].params,[companyId,'local:ci-operator']);
});
