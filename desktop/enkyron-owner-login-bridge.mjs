#!/usr/bin/env node
// Dedicated, bounded single-operator Owner login bridge.
// This is NOT a remote service, mail transport or multi-user security boundary.
// Password/OTP and session token are sent on private stdin, never on argv or logs.
// The principal is ALWAYS resolved from DB status/session, never from IPC JSON.
import os from 'node:os';
import path from 'node:path';
import * as fs from 'node:fs/promises';
import {constants as C} from 'node:fs';
import pg from 'pg';
import { resolveEnkyronDatabase } from './enkyron-uat-database.mjs';
import {loadPrivateResendConfig} from './enkyron-mail-private-config.mjs';
import {createResendInboxReader} from './enkyron-resend-inbox-read.mjs';
import {ownerMailAccessCard} from './enkyron-owner-mail-access.mjs';
import {
  loginLocalOwner, resolveLocalOwnerSession, logoutLocalOwner,
} from './enkyron-owner-session.mjs';

const OPERATIONS=new Set([
  'owner-setup-status','owner-login','owner-session-status','owner-logout',
  'owner-mail-status','owner-mail-threads','owner-mail-messages',
]);
const KEY_DIRECTORY=path.join(os.homedir(),'.local','share','enkyron','auth');
const KEY_FILE=path.join(KEY_DIRECTORY,'local-key-v1.bin');
function emit(value){process.stdout.write(JSON.stringify(value)+'\n');}
async function readPayload(){
  let raw='',length=0;
  for await(const chunk of process.stdin){
    length+=chunk.length;
    if(length>4096)throw new Error('Invalid Owner request');
    raw+=chunk.toString('utf8');
  }
  const value=JSON.parse(raw);
  if(!value||Array.isArray(value)||typeof value!=='object')
    throw new Error('Invalid Owner request');
  const allowed=['password','totp_code','session_token','mailbox','thread_id'];
  if(Object.keys(value).some(x=>!allowed.includes(x)))
    throw new Error('Invalid Owner request');
  return value;
}
async function trustedKey(){
  const dir=await fs.lstat(KEY_DIRECTORY);
  if(!dir.isDirectory()||dir.isSymbolicLink()||dir.uid!==process.getuid()
      ||(dir.mode&0o077)!==0)
    throw new Error('Owner private key is unavailable');
  const fh=await fs.open(KEY_FILE,C.O_RDONLY|C.O_NOFOLLOW);
  try{
    const st=await fh.stat();
    if(!st.isFile()||st.uid!==process.getuid()||st.nlink!==1
       ||(st.mode&0o777)!==0o600||st.size!==32)
      throw new Error('Owner private key is unavailable');
    return await fh.readFile();
  }finally{await fh.close();}
}
async function inspectSetup(pool,operator){
  // This read-only check is intentionally available BEFORE local key creation.
  // It never authenticates a caller or grants mail access.
  const row=(await pool.query(
    "SELECT to_regclass('public.enkyron_identity_principal_effective') AS registry,"+
    "to_regclass('public.enkyron_identity_credentials') AS credentials"
  )).rows[0];
  if(!row?.registry||!row?.credentials)
    return {state:'schema_missing'};
  const scope='local:'+operator;
  const entries=(await pool.query(
    'SELECT p.login_name,p.role,p.effective_status,'+
    'EXISTS(SELECT 1 FROM enkyron_identity_credentials c '+
    'WHERE c.principal_id=p.id) AS has_credentials '+
    'FROM enkyron_identity_principal_effective p WHERE p.workspace_key=$1',
    [scope]
  )).rows;
  if(entries.length===0)return {state:'not_enrolled'};
  if(entries.length!==1||entries[0].login_name!=='ceo'
      ||entries[0].role!=='organization_owner_l5'
      ||entries[0].has_credentials!==true)
    return {state:'needs_review'};
  const status=entries[0].effective_status;
  if(status==='pending'||status==='active'){
    try{await trustedKey();}
    catch{return {state:'needs_review'};}
    return {state:status};
  }
  return {state:'needs_review'};
}
async function main(){
  const operation=process.argv[2];
  if(!OPERATIONS.has(operation)||process.argv.length!==3)
    throw new Error('Unsupported Owner operation');
  const dbTarget=resolveEnkyronDatabase();
  // Owner credentials and provider-connected mail are OUT of scope for UAT.
  // Never reach the live owner database in synthetic preview mode.
  if(dbTarget.uat) throw new Error('ENKYRON UAT blocks Owner login and mail');
  const operator=os.userInfo().username;
  const pool=new pg.Pool({
    host:'/var/run/postgresql',database:dbTarget.database,user:operator,
    connectionTimeoutMillis:5000,max:1,
    options:"-c statement_timeout=10000 -c lock_timeout=4000"
  });
  try{
    if(operation==='owner-setup-status'){
      emit({ok:true,result:await inspectSetup(pool,operator)});
      return;
    }
    const req=await readPayload();
    const key=await trustedKey();
    if(operation==='owner-login'){
      const data=await loginLocalOwner(pool,{
        operator,password:req.password,totpCode:req.totp_code,key,
      });
      emit({ok:true,result:{
        session_token:data.sessionToken,expires_in_seconds:data.expiresInSeconds,
        role:data.principal.role,login_name:data.principal.loginName,
      }});
    }else if(operation==='owner-session-status'){
      const principal=await resolveLocalOwnerSession(pool,{
        operator,sessionToken:req.session_token,key,
      });
      emit({ok:true,result:{
        authenticated:true,login_name:principal.loginName,role:principal.role,
      }});
    }else if(operation==='owner-logout'){
      const done=await logoutLocalOwner(pool,{
        operator,sessionToken:req.session_token,key,
      });
      emit({ok:true,result:done});
    }else{
      const principal=await resolveLocalOwnerSession(pool,{
        operator,sessionToken:req.session_token,key,
      });
      let config;
      try{config=await loadPrivateResendConfig();}
      catch{
        if(operation==='owner-mail-status'){
          emit({ok:true,result:{
            connected:false,mailboxes:ownerMailAccessCard().mailboxes,
            notice:'Resend is not configured on this workstation',
          }});
          return;
        }
        throw new Error('Mail provider not configured');
      }
      if(operation==='owner-mail-status'){
        emit({ok:true,result:{
          connected:true,mailboxes:ownerMailAccessCard().mailboxes,
          notice:'Resend credentials configured',
        }});
        return;
      }
      const reader=createResendInboxReader({
        organizationId:principal.organizationId,
        mailboxes:config.mailboxes,
        credentialProvider:config.credentialProvider,
      });
      const mailbox=req.mailbox;
      if(operation==='owner-mail-threads'){
        emit({ok:true,result:await reader.listThreads({
          principal,mailbox,limit:30,
        })});
      }else{
        emit({ok:true,result:await reader.listThreadEmails({
          principal,mailbox,threadId:req.thread_id,limit:30,
        })});
      }
    }
  }finally{
    await pool.end();
  }
}
main().catch(()=>{
  // Never serialize SQL errors, passwords, tokens, encryption details or stack traces.
  const action=process.argv[2];
  const mail=action?.startsWith('owner-mail-');
  emit({ok:false,error:action==='owner-setup-status'
    ?'CEO account status unavailable'
    :mail
    ?'Mail unavailable; check Owner session and Resend configuration'
    :'Owner login unavailable or credentials not accepted'});
  process.exitCode=1;
});
