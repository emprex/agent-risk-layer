// UX-15A: user-entered personal display identity for a single local operator.
// NOT authentication, multi-user RBAC, ownership attestation or permission grants.
import {randomUUID} from 'node:crypto';

const CONTROL=/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;
function scope(actor) {
  if(typeof actor!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(actor))
    throw new Error('CRM invalid local operator');
  return {key:'local:'+actor,actor};
}
function boundedString(input,key,min,max,required=true) {
  if(typeof input!=='string'||input.length>max||CONTROL.test(input))
    throw new Error('CRM invalid personal profile '+key);
  const value=input.trim();
  if(value.length<min && (required||value.length))
    throw new Error('CRM personal profile '+key+' required');
  return value;
}
export function validatePersonalProfile(input) {
  if(!input||Array.isArray(input)||typeof input!=='object')
    throw new Error('CRM invalid personal profile');
  if(!Number.isSafeInteger(input.expected_revision)||input.expected_revision<0)
    throw new Error('CRM invalid personal profile revision');
  if(input.confirmed!==true)
    throw new Error('CRM personal profile requires explicit operator confirmation');
  const display_name=boundedString(input.display_name,'display_name',2,120);
  const job_title=boundedString(input.job_title,'job_title',2,100);
  const organization_display=boundedString(input.organization_display,'organization_display',2,160);
  const work_email=boundedString(input.work_email??'','work_email',3,254,false);
  if(work_email && (!/^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/.test(work_email)))
    throw new Error('CRM invalid personal profile email');
  return {expected_revision:input.expected_revision,display_name,job_title,
    organization_display,work_email};
}
export async function readPersonalProfile(pool,actor) {
  const owner=scope(actor);
  try {
    const rows=(await pool.query(
      'SELECT revision,display_name,job_title,organization_display,work_email,'
      +'declared_role,recorded_by,recorded_at FROM enkyron_operator_personal_profiles '
      +'WHERE workspace_key=$1 ORDER BY revision DESC LIMIT 21',[owner.key]
    )).rows;
    return {available:true,current:rows[0]??null,
      history:rows.slice(0,20).map(({revision,recorded_at,recorded_by})=>({revision,recorded_at,recorded_by})),
      more:rows.length>20,local_operator:owner.actor,
      notice:'Personal self-declaration for display only. L5 RBAC, MFA and multi-user permissions are NOT enabled.'};
  }catch(e){
    if(e?.code==='42P01')return {available:false,current:null,history:[],
      notice:'UX-15 personal-profile schema 107 not installed. Run the explicit backup/migration.'};
    throw e;
  }
}
export async function recordPersonalProfile(pool,input,actor,options={}){
  const data=validatePersonalProfile(input),owner=scope(actor);
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(814720267)');
    const prior=(await client.query(
      'SELECT revision,display_name,job_title,organization_display,work_email '
      +'FROM enkyron_operator_personal_profiles '
      +'WHERE workspace_key=$1 ORDER BY revision DESC LIMIT 1 FOR UPDATE',
      [owner.key]
    )).rows[0];
    const revision=prior?.revision??0;
    if(revision!==data.expected_revision)
      throw new Error('CRM personal profile was changed; reopen latest revision');
    if(prior&&['display_name','job_title','organization_display','work_email']
      .every(field=>(prior[field]??'')===data[field]))
      throw new Error('CRM personal profile is unchanged');
    const id=(options.uuid??randomUUID)();
    const saved=(await client.query(
      'INSERT INTO enkyron_operator_personal_profiles '
      +'(id,workspace_key,revision,display_name,job_title,organization_display,'
      +'work_email,recorded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) '
      +'RETURNING revision,recorded_at',
      [id,owner.key,revision+1,data.display_name,data.job_title,
        data.organization_display,data.work_email||null,owner.actor]
    )).rows[0];
    await client.query('COMMIT');
    return {revision:saved?.revision??revision+1,
      notice:'Personal display identity saved; no role permissions, Gmail access or historical CRM authors changed.'};
  }catch(error){
    await client.query('ROLLBACK').catch(()=>{});
    throw error;
  }finally{client.release();}
}
