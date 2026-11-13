import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import crypto,{randomUUID} from 'node:crypto';
import pg from 'pg';
import {
  hashEnkyronPassword, createEnkyronTotpSecret, encryptEnkyronTotpSecret,
  generateEnkyronSessionToken, hashEnkyronSessionToken,
} from '../desktop/enkyron-auth-crypto.mjs';

const url=process.env.ARL_CI_POSTGRES_URL||'';
function disposableCiUrl(){
  assert.equal(process.env.CI,'true','Only CI may write to this test database');
  const u=new URL(url);
  assert.equal(u.hostname,'127.0.0.1');
  assert.equal(u.pathname,'/arl_ci');
  assert.equal(u.username,'arl_ci');
  assert.equal(u.password,'synthetic-ci-only');
  assert.equal(u.search,'');
  return url;
}
test('UX-15B2 migration is explicit, additive and cannot auto-enrol real accounts',async()=>{
  const sql=await readFile(new URL('../migrations/109_enkyron_identity_credentials_sessions.sql',import.meta.url),'utf8');
  const script=await readFile(new URL('../scripts/enkyron-credentials-schema.mjs',import.meta.url),'utf8');
  for(const object of ['enkyron_identity_credentials','enkyron_identity_sessions',
    'enkyron_identity_auth_events'])assert.match(sql,new RegExp('CREATE TABLE '+object));
  assert.doesNotMatch(sql,/INSERT\s+INTO\s+enkyron_identity_/i);
  assert.doesNotMatch(sql,/ALTER\s+TABLE\s+(enkyron_operator_personal_profiles|enkyron_crm_|arl_workbench_)/i);
  assert.match(sql,/token_digest\s+TEXT NOT NULL UNIQUE/);
  assert.match(sql,/mfa_verified BOOLEAN NOT NULL CHECK \(mfa_verified IS TRUE\)/);
  assert.match(sql,/CHECK \(expires_at > created_at/);
  assert.match(sql,/last_totp_counter BIGINT NOT NULL DEFAULT -1/);
  assert.match(script,/109_enkyron_identity_credentials_sessions\.sql/);
  assert.match(script,/pg_dump/);
  assert.match(script,/pg_restore/);
  assert.match(script,/--check/);
  assert.match(script,/--apply/);
});

test('UX-15B2 isolated PostgreSQL credentials and sessions are absent until enrolled; security constraints work',{
  skip:!url&&'Disposable PostgreSQL only',timeout:60000,
},async()=>{
  const pool=new pg.Pool({connectionString:disposableCiUrl(),max:2});
  const person=randomUUID(),org='org-'+randomUUID().slice(0,8);
  const workspace='local:ci-'+randomUUID().slice(0,8);
  const ceo=randomUUID(),developer=randomUUID();
  const key=crypto.randomBytes(32);
  const fakePassword='CI synthetic private passphrase 139';
  try{
    await pool.query('INSERT INTO enkyron_identity_people '
      +'(id,workspace_key,organization_id) VALUES ($1,$2,$3)',
      [person,workspace,org]);
    for(const [id,name,role] of [
      [ceo,'ci-ceo','organization_owner_l5'],
      [developer,'ci-developer','developer_privileged']]){
      await pool.query('INSERT INTO enkyron_identity_principals '
        +'(id,person_id,workspace_key,organization_id,login_name,role) '
        +'VALUES ($1,$2,$3,$4,$5,$6)',
        [id,person,workspace,org,name,role]);
    }
    const existing=await pool.query('SELECT principal_id FROM enkyron_identity_credentials '
      +'WHERE principal_id=ANY($1::uuid[])',[[ceo,developer]]);
    assert.equal(existing.rowCount,0,'migration must not create credentials');
    const sessionsBefore=await pool.query('SELECT id FROM enkyron_identity_sessions '
      +'WHERE principal_id=ANY($1::uuid[])',[[ceo,developer]]);
    assert.equal(sessionsBefore.rowCount,0,'migration must not create sessions');
    assert.equal((await pool.query('SELECT effective_status FROM '
      +'enkyron_identity_principal_effective WHERE id=$1',[ceo])).rows[0].effective_status,
      'pending','creating identities does not activate them');

    for(const principal of [ceo,developer]){
      const secret=createEnkyronTotpSecret();
      const envelope=encryptEnkyronTotpSecret(secret,key,org+':'+principal);
      const hash=await hashEnkyronPassword(fakePassword);
      await pool.query('INSERT INTO enkyron_identity_credentials '
        +'(principal_id,password_hash,totp_secret_encrypted) VALUES($1,$2,$3)',
        [principal,hash,envelope]);
    }
    const stored=(await pool.query('SELECT * FROM enkyron_identity_credentials '
      +'WHERE principal_id=$1',[ceo])).rows[0];
    assert.ok(stored.password_hash.startsWith('scrypt-enkyron-v1$'));
    assert.equal(stored.password_hash.includes(fakePassword),false);
    assert.equal(stored.totp_secret_encrypted.includes(fakePassword),false);
    assert.equal(stored.last_totp_counter,'-1');
    assert.equal(stored.credential_version,1);

    const counter=123456789;
    let update=await pool.query('UPDATE enkyron_identity_credentials '
      +'SET last_totp_counter=$1 WHERE principal_id=$2 '
      +'AND last_totp_counter<$1 RETURNING last_totp_counter',[counter,ceo]);
    assert.equal(update.rowCount,1);
    update=await pool.query('UPDATE enkyron_identity_credentials '
      +'SET last_totp_counter=$1 WHERE principal_id=$2 '
      +'AND last_totp_counter<$1 RETURNING last_totp_counter',[counter,ceo]);
    assert.equal(update.rowCount,0,'same MFA step cannot be accepted again');
    update=await pool.query('UPDATE enkyron_identity_credentials '
      +'SET last_totp_counter=$1 WHERE principal_id=$2 '
      +'AND last_totp_counter<$1 RETURNING last_totp_counter',[counter-1,ceo]);
    assert.equal(update.rowCount,0,'older MFA step cannot be accepted');

    const token=generateEnkyronSessionToken(),tokenDigest=hashEnkyronSessionToken(token,key);
    const sessionId=randomUUID();
    await assert.rejects(()=>pool.query(
      'INSERT INTO enkyron_identity_sessions '
      +'(id,principal_id,token_digest,credential_version,mfa_verified,expires_at) '
      +"VALUES($1,$2,$3,1,FALSE,NOW()+INTERVAL '30 minutes')",
      [randomUUID(),ceo,crypto.randomBytes(32).toString('hex')]),/check|mfa_verified/i);
    await assert.rejects(()=>pool.query(
      'INSERT INTO enkyron_identity_sessions '
      +'(id,principal_id,token_digest,credential_version,mfa_verified,expires_at) '
      +"VALUES($1,$2,$3,1,TRUE,NOW()+INTERVAL '13 hours')",
      [randomUUID(),ceo,crypto.randomBytes(32).toString('hex')]),/check|expires/i);
    await pool.query('INSERT INTO enkyron_identity_sessions '
      +'(id,principal_id,token_digest,credential_version,mfa_verified,expires_at) '
      +"VALUES($1,$2,$3,1,TRUE,NOW()+INTERVAL '30 minutes')",
      [sessionId,ceo,tokenDigest]);
    assert.notEqual(token,tokenDigest);
    assert.equal((await pool.query('SELECT id FROM enkyron_identity_sessions '
      +'WHERE token_digest=$1',[token])).rowCount,0);
    assert.equal((await pool.query('SELECT id FROM enkyron_identity_sessions '
      +'WHERE token_digest=$1',[tokenDigest])).rowCount,1);
    await assert.rejects(()=>pool.query('INSERT INTO enkyron_identity_sessions '
      +'(id,principal_id,token_digest,credential_version,mfa_verified,expires_at) '
      +"VALUES($1,$2,$3,1,TRUE,NOW()+INTERVAL '30 minutes')",
      [randomUUID(),developer,tokenDigest]),/duplicate|unique/i);
    await pool.query('UPDATE enkyron_identity_sessions SET revoked_at=NOW() WHERE id=$1',
      [sessionId]);
    assert.ok((await pool.query('SELECT revoked_at FROM enkyron_identity_sessions '
      +'WHERE id=$1',[sessionId])).rows[0].revoked_at);

    const evId=randomUUID();
    await pool.query('INSERT INTO enkyron_identity_auth_events '
      +'(id,principal_id,event_type,reason) VALUES($1,$2,$3,$4)',
      [evId,ceo,'session_revoked','Synthetic CI session revocation test']);
    await assert.rejects(()=>pool.query(
      'UPDATE enkyron_identity_auth_events SET reason=$1 WHERE id=$2',
      ['Incorrect rewrite attempt',evId]),/cannot be changed|immutable|not allowed/i);
    await assert.rejects(()=>pool.query(
      'DELETE FROM enkyron_identity_auth_events WHERE id=$1',[evId]),
      /cannot be changed|immutable|not allowed/i);
    // These SQL storage tests explicitly DO NOT prove a real auth boundary:
    // CI SQL client can insert records while the principals remain pending.
    assert.equal((await pool.query('SELECT effective_status FROM '
      +'enkyron_identity_principal_effective WHERE id=$1',[ceo])).rows[0].effective_status,
      'pending');
  }finally{await pool.end();}
});
