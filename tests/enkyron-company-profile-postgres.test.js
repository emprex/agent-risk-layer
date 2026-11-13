import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {readCompanyProfile,recordCompanyProfile} from '../desktop/enkyron-company-profile.mjs';
const url=process.env.ARL_CI_POSTGRES_URL||'';
function disposable(){
  assert.equal(process.env.CI,'true');
  const u=new URL(url);
  assert.equal(u.hostname,'127.0.0.1');
  assert.equal(u.pathname,'/arl_ci');
  assert.equal(u.username,'arl_ci');
  assert.equal(u.password,'synthetic-ci-only');
  return url;
}
test('issuing profile: real PG append-only history, workspace isolation and no CRM alteration',{
  skip:!url&&'Disposable isolated CI DB only',timeout:45000
},async()=>{
  const pool=new pg.Pool({connectionString:disposable(),max:2});
  const user='ci-company-'+randomUUID().slice(0,8);
  const other=user+'-other';
  const count=async table=>(await pool.query('SELECT count(*)::int AS n FROM '+table)).rows[0].n;
  try{
    const before={customers:await count('enkyron_crm_companies'),
      prospects:await count('sales_prospects'),
      proposals:await count('enkyron_crm_proposal_drafts')};
    const initial=await readCompanyProfile(pool,user);
    assert.equal(initial.current,null);
    const base={
      expected_revision:0,confirmed:true,legal_name:'Synthetic Test Legal Ltd',
      trading_name:'Synthetic Trade',registration_number:'00000000',
      incorporation_country:'GB',
      registered_office:'10 Test Street, Example City, EX1 2AB',
      business_address:'',company_email:'finance@example.invalid',
      telephone:'',website:'https://example.invalid',vat_status:'unknown',
      vat_number:'',vat_effective_date:'',default_currency:'GBP',
      billing_contact:'Accounts',source_reference:'Synthetic fixture only',
      verification_notes:'These synthetic values are not verified against public registers.'
    };
    const one=await recordCompanyProfile(pool,base,user);
    assert.equal(one.revision,1);
    const first=(await readCompanyProfile(pool,user)).current;
    assert.equal(first.legal_name,'Synthetic Test Legal Ltd');
    assert.equal(first.verification_status,'operator_entered_unverified');
    assert.equal((await readCompanyProfile(pool,other)).current,null);
    await assert.rejects(()=>recordCompanyProfile(pool,{...base,expected_revision:0},user),/changed/);
    const two=await recordCompanyProfile(pool,{
      ...base,expected_revision:1,legal_name:'Synthetic Updated Legal Ltd',
      company_utr:'0123456789',tax_office_number:'001'
    },user);
    assert.equal(two.revision,2);
    const revised=await readCompanyProfile(pool,user);
    assert.equal(revised.current.legal_name,'Synthetic Updated Legal Ltd');
    assert.equal(revised.current.company_utr,'0123456789');
    assert.equal(revised.current.tax_office_number,'001');
    assert.equal(first.company_utr,null);
    assert.equal(first.tax_office_number,null);
    assert.ok(!Object.keys(revised.history[0]).includes('company_utr'));
    assert.ok(!Object.keys(revised.history[0]).includes('tax_office_number'));
    assert.deepEqual(revised.history.map(x=>x.revision),[2,1]);
    await assert.rejects(()=>pool.query(
      'UPDATE enkyron_operator_company_profiles SET legal_name=$1 WHERE id=$2',
      ['Tampered',first.id]),/cannot be changed or deleted/);
    await assert.rejects(()=>pool.query(
      'DELETE FROM enkyron_operator_company_profiles WHERE id=$1',[first.id]),
      /cannot be changed or deleted/);
    assert.equal((await readCompanyProfile(pool,user)).history.length,2);
    assert.deepEqual({customers:await count('enkyron_crm_companies'),
      prospects:await count('sales_prospects'),
      proposals:await count('enkyron_crm_proposal_drafts')},before);
  }finally{await pool.end();}
});
