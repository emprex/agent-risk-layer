// Disposable DB only: no local or production Owner credentials are touched.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto,{randomUUID} from 'node:crypto';
import pg from 'pg';
import {
  hashEnkyronPassword,createEnkyronTotpSecret,encryptEnkyronTotpSecret,
} from '../desktop/enkyron-auth-crypto.mjs';
import {
  loginLocalOwner,resolveLocalOwnerSession,logoutLocalOwner,
} from '../desktop/enkyron-owner-session.mjs';

const url=process.env.ARL_CI_POSTGRES_URL||'';
const pass='CI synthetic Owner passphrase only';
const key=crypto.randomBytes(32);
function disposableCiUrl(){
  assert.equal(process.env.CI,'true','Never write to a real account');
  const u=new URL(url);
  assert.equal(u.hostname,'127.0.0.1');
  assert.equal(u.pathname,'/arl_ci');
  assert.equal(u.username,'arl_ci');
  assert.equal(u.password,'synthetic-ci-only');
  assert.equal(u.search,'');
  return url;
}
function otp(secret,step){
  let acc=0,bits=0;const bytes=[],alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  for(const x of secret){
    acc=(acc<<5)|alphabet.indexOf(x);bits+=5;
    if(bits>=8){bits-=8;bytes.push((acc>>>bits)&255);}
  }
  const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(step));
  const h=crypto.createHmac('sha1',Buffer.from(bytes)).update(counter).digest();
  const i=h.at(-1)&15;
  const value=((h[i]&127)<<24)|(h[i+1]<<16)|(h[i+2]<<8)|h[i+3];
  return String(value%1000000).padStart(6,'0');
}
test('Owner login refuses malformed operators and OTPs before any DB connection',async()=>{
  const pool={connect:()=>{throw Error('must not connect');}};
  await assert.rejects(loginLocalOwner(pool,{
    operator:'../bad',password:pass,totpCode:'123456',key}),/Invalid local operator/);
  await assert.rejects(loginLocalOwner(pool,{
    operator:'ci',password:pass,totpCode:'invalid',key}),/Invalid Owner credentials/);
  await assert.rejects(resolveLocalOwnerSession(pool,{
    operator:'ci',sessionToken:'invalid',key}),/session expired/);
  await assert.rejects(logoutLocalOwner(pool,{
    operator:'ci',sessionToken:'invalid',key}),/session expired/);
});

test('verified CEO session, replay protection, revocation and revoked/disabled status',{
  skip:!url&&'Disposable PostgreSQL CI only',timeout:60000,
},async()=>{
  const pool=new pg.Pool({connectionString:disposableCiUrl(),max:2});
  const workspace='local:ci-auth-'+randomUUID().slice(0,8);
  const operator=workspace.slice(6);
  const person=randomUUID(),id=randomUUID(),org='org:'+randomUUID();
  const secret=createEnkyronTotpSecret();
  const passwordHash=await hashEnkyronPassword(pass);
  const encrypted=encryptEnkyronTotpSecret(secret,key,org+':'+id);
  let token;
  try{
    await pool.query('INSERT INTO enkyron_identity_people '+
      '(id,workspace_key,organization_id) VALUES($1,$2,$3)',[person,workspace,org]);
    await pool.query('INSERT INTO enkyron_identity_principals '+
      '(id,person_id,workspace_key,organization_id,login_name,role) '+
      'VALUES($1,$2,$3,$4,$5,$6)',
      [id,person,workspace,org,'ceo','organization_owner_l5']);
    await pool.query('INSERT INTO enkyron_identity_credentials '+
      '(principal_id,password_hash,totp_secret_encrypted) VALUES($1,$2,$3)',
      [id,passwordHash,encrypted]);
    let options={operator,password:pass,totpCode:'111111',key};
    await assert.rejects(loginLocalOwner(pool,options),/Invalid Owner credentials/);
    await pool.query('INSERT INTO enkyron_identity_status_events '+
      '(id,principal_id,event_type,reason) VALUES($1,$2,$3,$4)',
      [randomUUID(),id,'activated','Synthetic CI owner activation only']);
    await assert.rejects(loginLocalOwner(pool,{
      ...options,password:'not the correct password'
    }),/Invalid Owner credentials/);
    const step=Math.floor(Date.now()/30000),current=otp(secret,step);
    options={operator,password:pass,totpCode:current,key};
    const login=await loginLocalOwner(pool,options);
    token=login.sessionToken;
    assert.equal(login.expiresInSeconds,1800);
    assert.equal(login.principal.organizationId,org);
    assert.equal(login.principal.status,'active');
    assert.equal(login.principal.role,'organization_owner_l5');
    assert.equal(login.principal.verified,true);
    assert.equal((await pool.query('SELECT COUNT(*)::int AS total FROM '+
      'enkyron_identity_sessions WHERE principal_id=$1',[id])).rows[0].total,1);
    const resolved=await resolveLocalOwnerSession(pool,{
      operator,sessionToken:token,key
    });
    assert.equal(resolved.principalId,id);
    assert.equal(resolved.loginName,'ceo');
    await assert.rejects(loginLocalOwner(pool,options),/Invalid Owner credentials/,
      'TOTP must not be reused even with correct passphrase');
    await assert.rejects(resolveLocalOwnerSession(pool,{
      operator:'different-operator',sessionToken:token,key
    }),/session expired/);
    const out=await logoutLocalOwner(pool,{operator,sessionToken:token,key});
    assert.deepEqual(out,{revoked:true});
    await assert.rejects(resolveLocalOwnerSession(pool,{
      operator,sessionToken:token,key
    }),/session expired/);
    assert.deepEqual(await logoutLocalOwner(pool,{operator,sessionToken:token,key}),
      {revoked:false});
    const stored=(await pool.query('SELECT token_digest FROM enkyron_identity_sessions '+
      'WHERE principal_id=$1',[id])).rows[0].token_digest;
    assert.notEqual(stored,token);
    assert.equal(stored.includes(token),false);
    await pool.query('INSERT INTO enkyron_identity_status_events '+
      '(id,principal_id,event_type,reason) VALUES($1,$2,$3,$4)',
      [randomUUID(),id,'disabled','Synthetic CI owner disabled for test']);
    await assert.rejects(loginLocalOwner(pool,{
      ...options,totpCode:otp(secret,step+1),
    }),/Invalid Owner credentials/);
  }finally{await pool.end();}
});
