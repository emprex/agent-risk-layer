import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCompanyProfile,readCompanyProfile,recordCompanyProfile}
  from '../desktop/enkyron-company-profile.mjs';
const base={
  expected_revision:0,legal_name:'Synthetic Consulting Ltd',
  trading_name:'Synthetic Consulting',
  registration_number:'00000000',incorporation_country:'GB',
  registered_office:'1 Example Road, Example City, EX1 1AA',
  business_address:'',company_email:'billing@example.invalid',
  telephone:'',website:'https://example.invalid',
  vat_status:'unknown',vat_number:'',vat_effective_date:'',
  default_currency:'GBP',billing_contact:'Accounts team',
  source_reference:'Synthetic registry fixture',
  verification_notes:'Unverified test-only company information from a synthetic fixture.',
  confirmed:true
};
test('validation requires real operator entry, source and strict format, without tax inference',()=>{
  const value=validateCompanyProfile(base);
  assert.equal(value.incorporation_country,'GB');
  assert.equal(value.vat_status,'unknown');
  assert.equal(validateCompanyProfile({...base,company_utr:'01234 56789'}).company_utr,'0123456789');
  assert.equal(validateCompanyProfile({...base,tax_office_number:'001'}).tax_office_number,'001');
  assert.ok(!('vat_rate' in value));
  assert.ok(!('verified' in value));
  assert.equal(validateCompanyProfile({...base,vat_status:'registered',vat_number:'GB000000000'}).vat_status,'registered');
  for(const invalid of [null,{},[],{...base,expected_revision:-1},
    {...base,confirmed:false},{...base,legal_name:''},
    {...base,registered_office:'short'},
    {...base,source_reference:'ab'},
    {...base,verification_notes:'short'},
    {...base,incorporation_country:'UK'},
    {...base,incorporation_country:'EU'},
    {...base,incorporation_country:'ZZ'},
    {...base,default_currency:'BTC'},
    {...base,company_email:'not-email'},
    {...base,website:'file:///etc/passwd'},
    {...base,vat_status:'registered'},
    {...base,company_utr:'123456789'}, {...base,company_utr:'12345678900'},
    {...base,company_utr:'12345a7890'}, {...base,tax_office_number:'AB1'},
    {...base,tax_office_number:'1234'},
    {...base,vat_status:'unknown',vat_number:'GB111'},
    {...base,vat_status:'registered',vat_number:'GB123',vat_effective_date:'2026-02-30'},
    {...base,legal_name:'Synthetic'+String.fromCharCode(0)+'Injected'}]){
      assert.throws(()=>validateCompanyProfile(invalid),/ENKYRON/);
  }
});
test('scoped profile read with missing schema treatment',async()=>{
  const calls=[];
  const db={query:async(sql,params)=>{calls.push({sql,params});return {rows:[]};}};
  const result=await readCompanyProfile(db,'ci-operator');
  assert.equal(result.available,true);
  assert.equal(result.current,null);
  assert.deepEqual(calls[0].params,['local:ci-operator']);
  const missing=await readCompanyProfile({
    query:async()=>{const e=new Error('missing');e.code='42P01';throw e;}
  },'ci-operator');
  assert.equal(missing.available,false);
});
test('append-only write checks exact revision, actor and no UPDATE/DELETE',async()=>{
  const q=[];let released=false;
  const client={query:async(sql,params)=>{
    q.push({sql,params});
    if(sql.startsWith('SELECT revision'))return {rows:[]};
    if(sql.startsWith('INSERT'))return {rows:[{revision:1}]};
    return {rows:[]};
  },release:()=>{released=true}};
  const out=await recordCompanyProfile({connect:async()=>client},base,'ci-operator',
    {uuid:()=> '11111111-2222-4333-8444-555555555555'});
  assert.equal(out.revision,1);
  assert.deepEqual(q.map(x=>x.sql.split(' ')[0]),
    ['BEGIN','SELECT','SELECT','INSERT','COMMIT']);
  assert.equal(q[3].params[1],'local:ci-operator');
  assert.equal(q[3].params.at(-1),'ci-operator');
  assert.equal(q.some(x=>/^\s*(UPDATE|DELETE)\b/.test(x.sql)),false);
  assert.equal(released,true);
});
test('reject stale revision with rollback and no insert',async()=>{
  const q=[];
  const client={query:async(sql)=>{
    q.push(sql);
    if(sql.startsWith('SELECT revision'))return {rows:[{revision:2}]};
    return {rows:[]};
  },release:()=>{}};
  await assert.rejects(()=>recordCompanyProfile({connect:async()=>client},
    base,'ci-operator'),/changed/);
  assert.equal(q.at(-1),'ROLLBACK');
  assert.equal(q.some(x=>x.startsWith('INSERT')),false);
});
