// ENKYRON Owner session authority for the local single-operator desktop.
// Only a trusted service may call these functions. Never trust a client-supplied
// principal/role/organization, and never put passwords, OTPs or bearer tokens in
// command-line arguments, logs, the UI profile or Git.
//
// Security boundary: credentials are checked against PostgreSQL, session tokens
// are stored only as HMAC digests, TOTP counters advance atomically. This is NOT
// multi-user isolation against someone with the same OS/PostgreSQL account.
import {randomUUID} from 'node:crypto';
import {
  verifyEnkyronPassword, decryptEnkyronTotpSecret, matchEnkyronTotpCounter,
  generateEnkyronSessionToken, hashEnkyronSessionToken,
} from './enkyron-auth-crypto.mjs';
import {OWNER_LOGIN, OWNER_ROLE} from './enkyron-owner-enrollment.mjs';

const LOCAL=/^[A-Za-z0-9_.-]{1,80}$/;
const GENERIC='Invalid Owner credentials or account unavailable';
const LOCK_AFTER=5;
const LOCK_MINUTES=5;
const SESSION_MINUTES=30;
function workspace(operator){
  if(typeof operator!=='string'||!LOCAL.test(operator))
    throw new Error('Invalid local operator');
  return 'local:'+operator;
}
function requireKey(key){
  if(!Buffer.isBuffer(key)||key.length!==32)
    throw new Error('Owner authentication key unavailable');
}
function requireCredentials(password,totpCode){
  if(typeof password!=='string'||password.length>200||password.length<1
      ||typeof totpCode!=='string'||!/^\d{6}$/.test(totpCode))
    throw new Error(GENERIC);
}
async function event(client,principalId,type,reason){
  await client.query(
    'INSERT INTO enkyron_identity_auth_events (id,principal_id,event_type,reason) '+
    'VALUES($1,$2,$3,$4)',
    [randomUUID(),principalId,type,reason]
  );
}
async function failLogin(client,principal,type){
  const attempts=Math.min(1000000,Number(principal.failed_attempts)+1);
  await client.query(
    'UPDATE enkyron_identity_credentials SET failed_attempts=$2::integer, '+
    "locked_until=CASE WHEN $2::integer >= $3::integer THEN NOW()+INTERVAL '5 minutes' "+
    'ELSE locked_until END,updated_at=NOW() WHERE principal_id=$1',
    [principal.id,attempts,LOCK_AFTER]
  );
  await event(client,principal.id,type,'Owner sign-in was refused by credential validation');
  if(attempts===LOCK_AFTER)
    await event(client,principal.id,'account_locked',
      'Owner locked after five invalid sign-in attempts');
  await client.query('COMMIT');
  throw new Error(GENERIC);
}

/**
 * Authenticates against an *active* CEO principal in the exact local workspace.
 * Caller must be a private local auth service, not an arbitrary IPC command.
 * Password/OTP arrive only through a protected request body and are never logged.
 */
export async function loginLocalOwner(pool,{operator,password,totpCode,key}){
  const scope=workspace(operator);
  requireKey(key);
  requireCredentials(password,totpCode);
  const client=await pool.connect();
  let inTransaction=false;
  try{
    await client.query('BEGIN');
    inTransaction=true;
    const row=(await client.query(
      'SELECT p.id,p.person_id,p.organization_id,p.login_name,p.role,'+
      'e.effective_status AS status,c.password_hash,c.totp_secret_encrypted,'+
      'c.last_totp_counter,c.failed_attempts,c.locked_until,c.credential_version '+
      'FROM enkyron_identity_principals p '+
      'JOIN enkyron_identity_principal_effective e ON e.id=p.id '+
      'JOIN enkyron_identity_credentials c ON c.principal_id=p.id '+
      'WHERE p.workspace_key=$1 AND p.login_name=$2 AND p.role=$3 '+
      'FOR UPDATE OF c',
      [scope,OWNER_LOGIN,OWNER_ROLE]
    )).rows;
    if(rowsLengthInvalid(row))throw new Error(GENERIC);
    const principal=row[0];
    if(principal.status!=='active' ||
        (principal.locked_until&&new Date(principal.locked_until).getTime()>Date.now()))
      throw new Error(GENERIC);
    if(!await verifyEnkyronPassword(password,principal.password_hash)){
      await failLogin(client,principal,'login_denied');
    }
    let counter=null;
    try{
      const secret=decryptEnkyronTotpSecret(principal.totp_secret_encrypted,
        key,principal.organization_id+':'+principal.id);
      counter=matchEnkyronTotpCounter(secret,totpCode);
    }catch{
      // No decryption error details ever escape. Treat mismatched encryption
      // key as an authentication failure without disclosing stored credentials.
      counter=null;
    }
    if(counter===null){
      await failLogin(client,principal,'mfa_denied');
    }
    const changed=await client.query(
      'UPDATE enkyron_identity_credentials SET last_totp_counter=$2,'+
      'failed_attempts=0,locked_until=NULL,updated_at=NOW() '+
      'WHERE principal_id=$1 AND last_totp_counter<$2',
      [principal.id,counter]
    );
    if(changed.rowCount!==1){
      await failLogin(client,principal,'mfa_replay_denied');
    }
    const sessionToken=generateEnkyronSessionToken();
    const digest=hashEnkyronSessionToken(sessionToken,key);
    await client.query(
      'INSERT INTO enkyron_identity_sessions '+
      '(id,principal_id,token_digest,credential_version,mfa_verified,expires_at) '+
      "VALUES($1,$2,$3,$4,TRUE,NOW()+INTERVAL '30 minutes')",
      [randomUUID(),principal.id,digest,principal.credential_version]
    );
    await event(client,principal.id,'login_success',
      'Owner password and MFA verified; short local session issued');
    await client.query('COMMIT');
    inTransaction=false;
    return {
      sessionToken,
      expiresInSeconds:SESSION_MINUTES*60,
      principal:{
        verified:true,status:'active',principalId:principal.id,
        personId:principal.person_id,organizationId:principal.organization_id,
        loginName:OWNER_LOGIN,role:OWNER_ROLE
      }
    };
  }catch(e){
    if(inTransaction)await client.query('ROLLBACK').catch(()=>{});
    if(e.message===GENERIC)throw e;
    throw new Error('Owner sign-in unavailable');
  }finally{
    client.release();
  }
}
function rowsLengthInvalid(rows){return !Array.isArray(rows)||rows.length!==1;}

/** Resolve scope server-side on EVERY request; caller may supply a token, never a role. */
export async function resolveLocalOwnerSession(pool,{operator,sessionToken,key}){
  const scope=workspace(operator);
  requireKey(key);
  let digest;
  try{digest=hashEnkyronSessionToken(sessionToken,key);}
  catch{throw new Error('Owner session expired or unavailable');}
  const rows=(await pool.query(
    'SELECT p.id,p.person_id,p.organization_id,p.login_name,p.role,'+
    'e.effective_status AS status FROM enkyron_identity_sessions s '+
    'JOIN enkyron_identity_principals p ON p.id=s.principal_id '+
    'JOIN enkyron_identity_principal_effective e ON e.id=p.id '+
    'JOIN enkyron_identity_credentials c ON c.principal_id=p.id '+
    'WHERE s.token_digest=$1 AND p.workspace_key=$2 '+
    'AND p.login_name=$3 AND p.role=$4 '+
    'AND e.effective_status=$5 AND s.mfa_verified=TRUE '+
    'AND s.revoked_at IS NULL AND s.expires_at>NOW() '+
    'AND s.credential_version=c.credential_version',
    [digest,scope,OWNER_LOGIN,OWNER_ROLE,'active']
  )).rows;
  if(rowsLengthInvalid(rows))throw new Error('Owner session expired or unavailable');
  const user=rows[0];
  return {
    verified:true,status:'active',principalId:user.id,
    personId:user.person_id,organizationId:user.organization_id,
    loginName:OWNER_LOGIN,role:OWNER_ROLE
  };
}

/** Revoke by matching exact HMAC session digest, not by client-supplied actor IDs. */
export async function logoutLocalOwner(pool,{operator,sessionToken,key}){
  const scope=workspace(operator);
  requireKey(key);
  let digest;
  try{digest=hashEnkyronSessionToken(sessionToken,key);}
  catch{throw new Error('Owner session expired or unavailable');}
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const rows=(await client.query(
      'UPDATE enkyron_identity_sessions s SET revoked_at=NOW() '+
      'FROM enkyron_identity_principals p '+
      'WHERE s.principal_id=p.id AND s.token_digest=$1 '+
      'AND p.workspace_key=$2 AND p.login_name=$3 AND p.role=$4 '+
      'AND s.revoked_at IS NULL RETURNING s.principal_id',
      [digest,scope,OWNER_LOGIN,OWNER_ROLE]
    )).rows;
    if(rows.length===1)await event(client,rows[0].principal_id,'session_revoked',
      'Owner explicitly signed out of the local session');
    await client.query('COMMIT');
    return {revoked:rows.length===1};
  }catch{
    await client.query('ROLLBACK').catch(()=>{});
    throw new Error('Owner sign-out unavailable');
  }finally{
    client.release();
  }
}
