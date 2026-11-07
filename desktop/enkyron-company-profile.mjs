// ENKYRON issuing-company identity. Distinct from customer CRM companies.
// Operator-entered records only; never assert registry, tax or invoice validation.
import {randomUUID} from 'node:crypto';

const FIELDS = Object.freeze([
  'legal_name','trading_name','registration_number','company_utr','tax_office_number','incorporation_country',
  'registered_office','business_address','company_email','telephone','website',
  'vat_status','vat_number','vat_effective_date','default_currency',
  'billing_contact','source_reference','verification_notes'
]);
const LIMITS = Object.freeze({
  legal_name:160,trading_name:160,registration_number:80,company_utr:20,tax_office_number:10,
  registered_office:600,business_address:600,company_email:254,
  telephone:80,website:500,vat_number:80,billing_contact:300,
  source_reference:500,verification_notes:2000
});
const VAT=['unknown','registered','not_registered','application_pending'];
const CURRENCIES=['GBP','EUR','USD'];
const DISALLOWED_COUNTRIES=['UK','EU','ZZ','UN','EZ','XA','XB'];
function scope(actor){
  if(typeof actor!=='string'||!/^[a-zA-Z0-9_.-]{1,80}$/.test(actor))
    throw new Error('ENKYRON invalid local operator');
  return {key:'local:'+actor,actor};
}
function string(input,name,required=false){
  const value=input??'';
  if(typeof value!=='string'||value.length>(LIMITS[name]??100)||
    /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)||
    (name!=='registered_office'&&name!=='business_address'&&
     name!=='verification_notes'&&/[\r\n]/.test(value)))
    throw new Error('ENKYRON invalid '+name);
  const cleaned=value.trim();
  if(required&&!cleaned)throw new Error('ENKYRON '+name+' required');
  return cleaned;
}
export function validateCompanyProfile(input){
  if(!input||typeof input!=='object'||Array.isArray(input))
    throw new Error('ENKYRON invalid company profile');
  if(!Number.isSafeInteger(input.expected_revision)||input.expected_revision<0)
    throw new Error('ENKYRON invalid expected revision');
  if(input.confirmed!==true)
    throw new Error('ENKYRON operator confirmation required');
  const data={};
  for(const f of FIELDS){
    if(f==='incorporation_country'||f==='vat_status'||f==='vat_effective_date'||f==='default_currency')continue;
    data[f]=string(input[f],f,['legal_name','registered_office','source_reference','verification_notes'].includes(f));
  }
  // HMRC Corporation Tax identifiers are NOT VAT registration identifiers.
  // Accept only their textual digit form, preserve leading zeros, never derive values.
  if(data.company_utr){
    data.company_utr=data.company_utr.replace(/[ -]/g,'');
    if(!/^[0-9]{10}$/.test(data.company_utr))
      throw new Error('ENKYRON Company UTR must contain exactly 10 digits');
  }
  if(data.tax_office_number&&!/^[0-9]{3}$/.test(data.tax_office_number))
    throw new Error('ENKYRON Tax Office Number must contain exactly 3 digits');
  if(data.legal_name.length<2)throw new Error('ENKYRON legal name too short');
  if(data.registered_office.length<10)throw new Error('ENKYRON registered office requires full address');
  if(data.source_reference.length<3)throw new Error('ENKYRON source reference too short');
  if(data.verification_notes.length<20)throw new Error('ENKYRON verification notes require 20 characters');
  const country=input.incorporation_country;
  if(typeof country!=='string'||country.length>4)throw new Error('ENKYRON invalid incorporation country');
  data.incorporation_country=country.trim().toUpperCase();
  if(!/^[A-Z]{2}$/.test(data.incorporation_country)||
     DISALLOWED_COUNTRIES.includes(data.incorporation_country))
    throw new Error('ENKYRON incorporation country requires ISO 3166-1 alpha-2');
  if(!VAT.includes(input.vat_status))throw new Error('ENKYRON invalid VAT status');
  data.vat_status=input.vat_status;
  if(!CURRENCIES.includes(input.default_currency))
    throw new Error('ENKYRON invalid billing currency');
  data.default_currency=input.default_currency;
  data.vat_effective_date=input.vat_effective_date??'';
  if(typeof data.vat_effective_date!=='string'||data.vat_effective_date.length>10)
    throw new Error('ENKYRON invalid VAT effective date');
  if(data.vat_effective_date){
    const date=data.vat_effective_date;
    const parsed=new Date(date+'T00:00:00Z');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||
       !Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==date)
      throw new Error('ENKYRON invalid VAT effective date');
  }
  if(data.vat_status==='registered'&&!data.vat_number)
    throw new Error('ENKYRON VAT number required for operator-reported registration');
  if(data.vat_status!=='registered'&&(data.vat_number||data.vat_effective_date))
    throw new Error('ENKYRON VAT details require registered status');
  if(data.company_email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.company_email))
    throw new Error('ENKYRON invalid company email');
  if(data.website){
    let u;
    try{u=new URL(data.website);}catch{throw new Error('ENKYRON invalid website');}
    if(!['https:','http:'].includes(u.protocol)||!u.hostname||u.username||u.password)
      throw new Error('ENKYRON invalid website');
  }
  return {expected_revision:input.expected_revision,...data};
}
export async function readCompanyProfile(pool,actor){
  const {key}=scope(actor);
  try{
    const rows=(await pool.query(
      'SELECT * FROM enkyron_operator_company_profiles '
      +'WHERE workspace_key=$1 ORDER BY revision DESC LIMIT 21',[key]
    )).rows;
    return {available:true,current:rows[0]??null,
      history:rows.slice(0,20).map(({revision,recorded_by,recorded_at,source_reference})=>
        ({revision,recorded_by,recorded_at,source_reference})),
      more:rows.length>20,
      notice:'Operator-entered identity, not independently verified or authorised for invoice issuance.'};
  }catch(e){
    if(e?.code==='42P01')return {available:false,current:null,history:[],
      notice:'ENKYRON issuing-company profile schema 076 not installed.'};
    throw e;
  }
}
export async function recordCompanyProfile(pool,input,actor,options={}){
  const data=validateCompanyProfile(input),owner=scope(actor);
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    // Serialise writes even on first creation, when no row exists to lock.
    await client.query('SELECT pg_advisory_xact_lock(814720261)');
    const prior=(await client.query(
      'SELECT revision FROM enkyron_operator_company_profiles '
      +'WHERE workspace_key=$1 ORDER BY revision DESC LIMIT 1 FOR UPDATE',
      [owner.key]
    )).rows[0];
    const revision=prior?.revision??0;
    if(revision!==data.expected_revision)
      throw new Error('ENKYRON company profile changed; reopen the latest revision');
    const columns=['id','workspace_key','revision',...FIELDS,'recorded_by'];
    const values=[(options.uuid??randomUUID)(),owner.key,revision+1,
      ...FIELDS.map(f=>data[f]||null),owner.actor];
    // Only nullable optional fields are NULL. VAT/currency and required fields remain nonempty.
    const sql='INSERT INTO enkyron_operator_company_profiles ('+columns.join(',')+
      ') VALUES ('+columns.map((_,i)=>'$'+(i+1)).join(',')+
      ') RETURNING revision,recorded_at';
    const saved=(await client.query(sql,values)).rows[0];
    await client.query('COMMIT');
    return {revision:saved?.revision??revision+1,
      notice:'Issuing-company profile saved as an operator-entered, unverified revision. No quote or invoice was issued.'};
  }catch(e){
    await client.query('ROLLBACK').catch(()=>{});
    throw e;
  }finally{client.release();}
}
