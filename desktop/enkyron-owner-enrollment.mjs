// UX-15B3: strictly local, explicit *pending* Owner credential enrollment.
// This module does NOT authorize ENKYRON IPC actions or authenticate sessions.
// The Linux/PostgreSQL owner still has direct database access; no multi-user
// security claims can be made until a trusted service boundary is deployed.
import {randomUUID} from 'node:crypto';
import {
  hashEnkyronPassword,verifyEnkyronPassword,matchEnkyronTotpCounter,
  encryptEnkyronTotpSecret,decryptEnkyronTotpSecret,
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
    '(SELECT COUNT(*)::int FROM enkyron_identity_people WHERE workspace_key=$1) AS persons,'+
    '(SELECT COUNT(*)::int FROM enkyron_identity_principals WHERE workspace_key=$1) AS principals,'+
    '(SELECT COUNT(*)::int FROM enkyron_identity_credentials c '+
    ' JOIN enkyron_identity_principals p ON p.id=c.principal_id '+
    ' WHERE p.workspace_key=$1) AS credentials,'+
    '(SELECT COUNT(*)::int FROM enkyron_identity_sessions s '+
    ' JOIN enkyron_identity_principals p ON p.id=s.principal_id '+
    ' WHERE p.workspace_key=$1) AS sessions'
  ,[workspace])).rows[0];
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
  operator,password,totpSecret,totpCode,key,nowMs=Date.now(),activate=false
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
      '(SELECT COUNT(*)::int FROM enkyron_identity_people WHERE workspace_key=$1) AS persons,'+
      '(SELECT COUNT(*)::int FROM enkyron_identity_principals WHERE workspace_key=$1) AS principals,'+
      '(SELECT COUNT(*)::int FROM enkyron_identity_credentials c '+
      ' JOIN enkyron_identity_principals p ON p.id=c.principal_id '+
      ' WHERE p.workspace_key=$1) AS credentials,'+
      '(SELECT COUNT(*)::int FROM enkyron_identity_sessions s '+
      ' JOIN enkyron_identity_principals p ON p.id=s.principal_id '+
      ' WHERE p.workspace_key=$1) AS sessions'
    ,[workspace])).rows[0];
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
    // The local setup command may explicitly self-activate in the SAME
    // transaction after user confirmation, backup and password + MFA proof.
    // Library consumers default to pending (no implicit activation).
    if(activate===true){
      await client.query(
        'INSERT INTO enkyron_identity_status_events '+
        '(id,principal_id,event_type,reason) VALUES($1,$2,$3,$4)',
        [randomUUID(),principalId,'activated',
          'Explicit private local Owner self-activation after MFA enrollment']
      );
    }
    await client.query('COMMIT');
    return {workspace,organizationId,personId,principalId,
      loginName:OWNER_LOGIN,role:OWNER_ROLE,
      status:activate===true?'active':'pending'};
  }catch(e){
    await client.query('ROLLBACK').catch(()=>{});
    throw e;
  }finally{client.release();}
}


/** Activate an existing pending CEO only after passphrase AND a NEW TOTP code.
 * This is an explicit, local CLI bootstrap recovery, never a normal Qt IPC action.
 */
export async function activatePendingLocalOwner(pool,{
  operator,password,totpCode,key,nowMs=Date.now()
}={}){
  const scope=workspaceFor(operator);
  if(!Buffer.isBuffer(key)||key.length!==32)
    throw new Error('Owner private key unavailable');
  if(typeof password!=='string'||password.length<15||password.length>200
      ||typeof totpCode!=='string'||!/^\d{6}$/.test(totpCode))
    throw new Error('Owner activation credentials invalid');
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const rows=(await client.query(
      'SELECT p.id,p.organization_id,p.login_name,p.role,'+
      'e.effective_status AS status,c.password_hash,c.totp_secret_encrypted,'+
      'c.last_totp_counter FROM enkyron_identity_principals p '+
      'JOIN enkyron_identity_principal_effective e ON e.id=p.id '+
      'JOIN enkyron_identity_credentials c ON c.principal_id=p.id '+
      'WHERE p.workspace_key=$1 FOR UPDATE OF c',
      [scope]
    )).rows;
    if(rows.length!==1||rows[0].login_name!==OWNER_LOGIN
        ||rows[0].role!==OWNER_ROLE||rows[0].status!=='pending')
      throw new Error('CEO account is not a unique pending Owner');
    const owner=rows[0];
    if(!await verifyEnkyronPassword(password,owner.password_hash))
      throw new Error('Owner activation credentials invalid');
    let counter=null;
    try{
      const secret=decryptEnkyronTotpSecret(owner.totp_secret_encrypted,
        key,owner.organization_id+':'+owner.id);
      counter=matchEnkyronTotpCounter(secret,totpCode,nowMs);
    }catch{
      counter=null;
    }
    if(counter===null||counter<=Number(owner.last_totp_counter))
      throw new Error('Owner activation MFA invalid or already used');
    const updated=await client.query(
      'UPDATE enkyron_identity_credentials SET last_totp_counter=$2,updated_at=NOW() '+
      'WHERE principal_id=$1 AND last_totp_counter<$2',
      [owner.id,counter]
    );
    if(updated.rowCount!==1)
      throw new Error('Owner activation MFA already used');
    await client.query(
      'INSERT INTO enkyron_identity_status_events '+
      '(id,principal_id,event_type,reason) VALUES($1,$2,$3,$4)',
      [randomUUID(),owner.id,'activated',
        'Owner activated using verified local passphrase and fresh MFA']
    );
    await client.query('COMMIT');
    return {status:'active',loginName:OWNER_LOGIN,role:OWNER_ROLE,workspace:scope};
  }catch{
    await client.query('ROLLBACK').catch(()=>{});
    throw new Error('Owner activation unavailable or credentials refused');
  }finally{client.release();}
}
