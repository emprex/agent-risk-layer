import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {
  inspectOwnerEnrollment,enrollPendingLocalOwner,
} from '../desktop/enkyron-owner-enrollment.mjs';
import {
  createEnkyronTotpSecret,decryptEnkyronTotpSecret,verifyEnkyronPassword,
} from '../desktop/enkyron-auth-crypto.mjs';
import {authoriseEnkyronOperation} from '../desktop/enkyron-access-policy.mjs';

const url=process.env.ARL_CI_POSTGRES_URL||'';
function disposable(){
  assert.equal(process.env.CI,'true');
  const u=new URL(url);
  assert.equal(u.hostname,'127.0.0.1');
  assert.equal(u.pathname,'/arl_ci');
  assert.equal(u.username,'arl_ci');
  assert.equal(u.password,'synthetic-ci-only');
  assert.equal(u.search,'');
  return url;
}
// Independent RFC-6238-style test helper. Test secrets are ephemeral.
function totpCode(secret,step){
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567',bytes=[];
  let bits=0,value=0;
  for(const c of secret){
    value=(value<<5)|alphabet.indexOf(c);bits+=5;
    if(bits>=8){bytes.push((value>>>(bits-8))&255);bits-=8;}
  }
  const msg=Buffer.alloc(8);msg.writeBigUInt64BE(BigInt(step));
  const digest=crypto.createHmac('sha1',Buffer.from(bytes)).update(msg).digest();
  const offset=digest.at(-1)&15;
  const val=((digest[offset]&127)<<24)|(digest[offset+1]<<16)|
    (digest[offset+2]<<8)|digest[offset+3];
  return String(val%1_000_000).padStart(6,'0');
}
test('UX-15B3 script is local and explicit, with private TTY input and backup',async()=>{
  const source=await readFile(new URL('../scripts/enkyron-enroll-owner.mjs',import.meta.url),'utf8');
  assert.match(source,/--check/);
  assert.match(source,/--enroll/);
  assert.match(source,/getpass/);
  assert.match(source,/pg_dump/);
  assert.match(source,/pg_restore/);
  assert.match(source,/O_NOFOLLOW/);
  assert.match(source,/process\.stdin\.isTTY/);
  assert.doesNotMatch(source,/password\s*=\s*process\.argv/);
  assert.doesNotMatch(source,/node:http|listen\(/);
});
test('UX-15B3 invalid local operator and unverified MFA cannot create principals',async()=>{
  const secret=createEnkyronTotpSecret();
  const pool={query:()=>{throw Error('must not query DB');}};
  await assert.rejects(()=>inspectOwnerEnrollment(pool,'../other'),/Invalid local operator/);
  await assert.rejects(()=>enrollPendingLocalOwner(pool,{
    operator:'synthetic',password:'Synthetic passphrase a lot of words',
    totpSecret:secret,totpCode:'nototp',key:crypto.randomBytes(32),
  }),/MFA setup code invalid/);
});
test('UX-15B3 synthetic CEO enrollment creates ONE pending principal, never live access',{
  skip:!url&&'Only dedicated disposable PostgreSQL CI',timeout:60000,
},async()=>{
  const pool=new pg.Pool({connectionString:disposable(),max:2});
  const actor='ci-enroll-'+crypto.randomUUID().slice(0,8),workspace='local:'+actor;
  const key=crypto.randomBytes(32),secret=createEnkyronTotpSecret();
  const password='Synthetic CI CEO private passphrase';
  const nowMs=1_900_000_000_000,step=Math.floor(nowMs/30000);
  const code=totpCode(secret,step);
  try{
    const before=await inspectOwnerEnrollment(pool,actor);
    assert.equal(before.empty,true);
    assert.deepEqual(Object.values(before.counts),[0,0,0,0]);
    const enrolled=await enrollPendingLocalOwner(pool,{
      operator:actor,password,totpSecret:secret,totpCode:code,key,nowMs,
    });
    assert.equal(enrolled.workspace,workspace);
    assert.equal(enrolled.status,'pending');
    assert.equal(enrolled.loginName,'ceo');
    assert.equal(enrolled.role,'organization_owner_l5');

    const people=(await pool.query('SELECT id,workspace_key,organization_id FROM '+
      'enkyron_identity_people WHERE workspace_key=$1',[workspace])).rows;
    assert.equal(people.length,1);
    assert.equal(String(people[0].id),enrolled.personId);
    const p=(await pool.query(
      'SELECT id,person_id,organization_id,role,effective_status FROM '+
      'enkyron_identity_principal_effective WHERE workspace_key=$1',[workspace])).rows;
    assert.equal(p.length,1);
    assert.equal(p[0].effective_status,'pending');
    assert.equal(p[0].person_id,enrolled.personId);
    assert.equal(p[0].role,'organization_owner_l5');
    assert.equal(p[0].organization_id,enrolled.organizationId);

    const creds=(await pool.query(
      'SELECT password_hash,totp_secret_encrypted,last_totp_counter '+
      'FROM enkyron_identity_credentials WHERE principal_id=$1',[enrolled.principalId])).rows[0];
    assert.equal(await verifyEnkyronPassword(password,creds.password_hash),true);
    assert.equal(creds.password_hash.includes(password),false);
    assert.equal(creds.totp_secret_encrypted.includes(secret),false);
    assert.equal(decryptEnkyronTotpSecret(creds.totp_secret_encrypted,
      key,enrolled.organizationId+':'+enrolled.principalId),secret);
    assert.equal(Number(creds.last_totp_counter),step);
    assert.equal((await pool.query(
      'SELECT COUNT(*)::int AS n FROM enkyron_identity_sessions '+
      'WHERE principal_id=$1',[enrolled.principalId])).rows[0].n,0);
    const events=(await pool.query('SELECT event_type FROM enkyron_identity_auth_events '+
      'WHERE principal_id=$1',[enrolled.principalId])).rows;
    assert.deepEqual(events.map(x=>x.event_type),['credential_enrolled']);

    const after=await inspectOwnerEnrollment(pool,actor);
    assert.equal(after.empty,false);
    assert.deepEqual(Object.values(after.counts),[1,1,1,0]);
    await assert.rejects(()=>enrollPendingLocalOwner(pool,{
      operator:actor,password,totpSecret:secret,totpCode:code,key,nowMs,
    }),/Owner bootstrap refused/);
    const unchanged=await inspectOwnerEnrollment(pool,actor);
    assert.deepEqual(unchanged.counts,after.counts);

    // A pending principal cannot pass authorization by putting "verified"
    // in a self-declared display profile, and this test does not issue sessions.
    const denied=authoriseEnkyronOperation({
      verified:false,status:'pending',principalId:enrolled.principalId,
      personId:enrolled.personId,organizationId:enrolled.organizationId,
      role:'organization_owner_l5',
    },'crm:read',{organizationId:enrolled.organizationId});
    assert.equal(denied.allowed,false);
  }finally{await pool.end();}
});
