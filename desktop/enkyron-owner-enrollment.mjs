// UX-15B3: strictly local, explicit *pending* Owner credential enrollment.
// This module does NOT authorize ENKYRON IPC actions or authenticate sessions.
// The Linux/PostgreSQL owner still has direct database access; no multi-user
// security claims can be made until a trusted service boundary is deployed.
import {randomUUID} from 'node:crypto';
import {
  hashEnkyronPassword,matchEnkyronTotpCounter,encryptEnkyronTotpSecret,
} from './enkyron-auth-crypto.mjs';

const OPERATOR=/^[A-Za-z0-9_.-]{1,80}$/;
export const OWNER_LOGIN='ceo';
export const OWNER_ROLE='organization_owner_l5';

function workspaceFor(operator){
  if(typeof operator!=='string'||!OPERATOR.test(operator))
    throw new Error('Invalid local operator');
  return 'local:'+operator;
}

export async function inspectOwnerEnrollment(pool,operator){
  const workspace=workspaceFor(operator);
  const rows=(await pool.query(
    'SELECT '+
    '(SELECT COUNT(*)::int FROM enkyron_identity_people) AS persons,'+
    '(SELECT COUNT(*)::int FROM enkyron_identity_principals) AS principals,'+
    '(SELECT COUNT(*)::int FROM enkyron_identity_credentials) AS credentials,'+
    '(SELECT COUNT(*)::int FROM enkyron_identity_sessions) AS sessions'
  )).rows[0];
  if(!rows||Object.values(rows).some(n=>!Number.isSafeInteger(n)||n<0))
    throw new Error('ENKYRON identity census unavailable');
  return {workspace,empty:rows.persons===0&&rows.principals===0
    &&rows.credentials===0&&rows.sessions===0,counts:rows};
}

/**
 * This is for a one-time local workstation bootstrap only.
 * Password, TOTP secret and code arrive from a local TTY, never IPC or
 * command-line arguments. A pending principal is NOT an active user account.
 */
export async function enrollPendingLocalOwner(pool,{
  operator,password,totpSecret,totpCode,key,nowMs=Date.now()
}){
  const workspace=workspaceFor(operator);
  if(!Buffer.isBuffer(key)||key.length!==32)
    throw new Error('Missing owner-only local encryption key');
  const step=matchEnkyronTotpCounter(totpSecret,totpCode,nowMs);
  if(step===null)throw new Error('MFA setup code invalid or expired');
  const passwordHash=await hashEnkyronPassword(password);
  const personId=randomUUID();
  const principalId=randomUUID();
  const organizationId='org:'+randomUUID();
  const envelope=encryptEnkyronTotpSecret(
    totpSecret,key,organizationId+':'+principalId
  );
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(814720269)');
    const census=(await client.query(
      'SELECT '+
      '(SELECT COUNT(*)::int FROM enkyron_identity_people) AS persons,'+
      '(SELECT COUNT(*)::int FROM enkyron_identity_principals) AS principals,'+
      '(SELECT COUNT(*)::int FROM enkyron_identity_credentials) AS credentials,'+
      '(SELECT COUNT(*)::int FROM enkyron_identity_sessions) AS sessions'
    )).rows[0];
    if(!census||Object.values(census).some(n=>n!==0))
      throw new Error('Owner bootstrap refused: identity records already exist');

    await client.query(
      'INSERT INTO enkyron_identity_people (id,workspace_key,organization_id) '+
      'VALUES($1,$2,$3)',
      [personId,workspace,organizationId]
    );
    await client.query(
      'INSERT INTO enkyron_identity_principals '+
      '(id,person_id,workspace_key,organization_id,login_name,role) '+
      'VALUES($1,$2,$3,$4,$5,$6)',
      [principalId,personId,workspace,organizationId,OWNER_LOGIN,OWNER_ROLE]
    );
    await client.query(
      'INSERT INTO enkyron_identity_credentials '+
      '(principal_id,password_hash,totp_secret_encrypted,last_totp_counter) '+
      'VALUES($1,$2,$3,$4)',
      [principalId,passwordHash,envelope,step]
    );
    await client.query(
      'INSERT INTO enkyron_identity_auth_events '+
      '(id,principal_id,event_type,reason) VALUES($1,$2,$3,$4)',
      [randomUUID(),principalId,'credential_enrolled',
        'Explicit local CEO credential enrollment; principal remains pending']
    );
    await client.query('COMMIT');
    return {workspace,organizationId,personId,principalId,
      loginName:OWNER_LOGIN,role:OWNER_ROLE,status:'pending'};
  }catch(e){
    await client.query('ROLLBACK').catch(()=>{});
    throw e;
  }finally{client.release();}
}
