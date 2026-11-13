#!/usr/bin/env node
// UX-15B3: explicit, single-workstation CEO *pending* credential bootstrap.
// Never called by ENKYRON UI, never automatic, no remote listener or secret args.
// No rights become effective inside the desktop until verified service auth exists.
import os from 'node:os';
import fs,{constants as FSC} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createInterface} from 'node:readline/promises';
import pg from 'pg';
import {createEnkyronTotpSecret} from '../desktop/enkyron-auth-crypto.mjs';
import {
  inspectOwnerEnrollment,enrollPendingLocalOwner,activatePendingLocalOwner,
} from '../desktop/enkyron-owner-enrollment.mjs';

const mode=process.argv[2];
if(!['--check','--enroll','--activate'].includes(mode)||process.argv.length!==3)
  throw new Error('Usage: node scripts/enkyron-enroll-owner.mjs --check | --enroll | --activate');

const operator=os.userInfo().username;
if(!/^[A-Za-z0-9_.-]{1,80}$/.test(operator))
  throw new Error('Invalid Linux operator');

const pool=new pg.Pool({
  host:'/var/run/postgresql',database:'arl_local',user:operator,
  connectionTimeoutMillis:5000,max:1,
});
async function verifyEnvironment(){
  const row=(await pool.query(
    'SELECT current_database() AS db,current_user AS actor'
  )).rows[0];
  if(row?.db!=='arl_local'||row?.actor!==operator)
    throw new Error('Unexpected PostgreSQL database or OS operator');
  const dir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','migrations');
  for(const version of [
    '108_enkyron_identity_registry.sql',
    '109_enkyron_identity_credentials_sessions.sql',
  ]){
    const sql=await fs.readFile(path.join(dir,version),'utf8');
    const expected=crypto.createHash('sha256').update(sql).digest('hex');
    const applied=(await pool.query(
      'SELECT checksum FROM schema_migrations WHERE version=$1',[version]
    )).rows[0]?.checksum;
    if(applied!==expected)throw new Error('Missing or inconsistent ENKYRON schema '+version);
  }
}
function run(command,args,timeout=180000){
  const p=spawnSync(command,args,{stdio:['ignore','ignore','pipe'],encoding:'utf8',timeout,maxBuffer:4096});
  if(p.status!==0)throw new Error('Required local backup command failed: '+command);
  return p;
}
async function backupDatabase(){
  const folder=path.join(os.homedir(),'.local','share','enkyron','backups');
  await fs.mkdir(folder,{recursive:true,mode:0o700});
  const filename=path.join(folder,
    'arl_local-before-owner-enrollment-'+new Date().toISOString().replace(/[:.]/g,'-')+'.dump');
  run('pg_dump',[
    '--format=custom','--no-password','--host=/var/run/postgresql',
    '--username='+operator,'--dbname=arl_local','--file='+filename,
  ]);
  await fs.chmod(filename,0o600);
  run('pg_restore',['--list',filename],30000);
  console.error('Verified owner-only database backup:',filename);
}
async function encryptionKey(){
  const folder=path.join(os.homedir(),'.local','share','enkyron','auth');
  await fs.mkdir(folder,{recursive:true,mode:0o700});
  const d=await fs.lstat(folder);
  if(!d.isDirectory()||d.uid!==process.getuid()||(d.mode&0o077)!==0)
    throw new Error('Unsafe owner-only ENKYRON auth directory');
  const location=path.join(folder,'local-key-v1.bin');
  let handle;
  try{
    handle=await fs.open(location,FSC.O_RDONLY|FSC.O_NOFOLLOW);
    const s=await handle.stat();
    if(!s.isFile()||s.uid!==process.getuid()||s.nlink!==1
       ||(s.mode&0o777)!==0o600||s.size!==32)
      throw new Error('Unsafe existing encryption key file');
    return await handle.readFile();
  }catch(error){
    if(error.code!=='ENOENT')throw error;
  }finally{await handle?.close();}
  const key=crypto.randomBytes(32);
  const fh=await fs.open(location,
    FSC.O_CREAT|FSC.O_EXCL|FSC.O_WRONLY|FSC.O_NOFOLLOW,0o600);
  try{await fh.writeFile(key);await fh.sync();}
  finally{await fh.close();}
  console.error('New owner-only local encryption key created (never share it).');
  return key;
}
function secretPrompt(label){
  const program=[
    'import getpass,json,sys',
    'value=getpass.getpass(sys.argv[1])',
    'sys.stdout.write(json.dumps(value))',
  ].join('\n');
  const p=spawnSync('python3',['-c',program,label],
    {stdio:['inherit','pipe','inherit'],encoding:'utf8',timeout:240000,maxBuffer:1024});
  if(p.status!==0)throw new Error('Private terminal input cancelled or unavailable');
  const value=JSON.parse(p.stdout);
  if(typeof value!=='string')throw new Error('Invalid private terminal input');
  return value;
}
async function confirmation(){
  const rl=createInterface({input:process.stdin,output:process.stderr});
  try{return (await rl.question(
    'Type ENROLL to create and activate your ONE CEO account: '
  )).trim()==='ENROLL';}
  finally{rl.close();}
}

try{
  await verifyEnvironment();
  const census=await inspectOwnerEnrollment(pool,operator);
  if(mode==='--check'){
    console.log('ENKYRON owner enrollment:',census.empty?'NOT ENROLLED':'IDENTITY REGISTRY NONEMPTY');
    console.log('Workspace:',census.workspace);
    console.log('Identity counts:',JSON.stringify(census.counts));
    const ready=(await pool.query(
      "SELECT p.effective_status FROM enkyron_identity_principal_effective p "+
      "WHERE p.workspace_key=$1 AND p.login_name='ceo'",
      [census.workspace]
    )).rows;
    console.log('CEO account status:',
      ready.length===1?ready[0].effective_status:'not enrolled or needs review');
  }else if(mode==='--activate'){
    if(!process.stdin.isTTY||!process.stderr.isTTY)
      throw new Error('Activation requires a private interactive terminal');
    if(census.empty)
      throw new Error('No pending CEO: first run --enroll');
    console.error('Activate the ONE existing pending CEO using its original passphrase and a fresh MFA code.');
    await backupDatabase();
    // Do not generate/rewrite the original encryption key during activation.
    const folder=path.join(os.homedir(),'.local','share','enkyron','auth');
    const location=path.join(folder,'local-key-v1.bin');
    const fd=await fs.open(location,FSC.O_RDONLY|FSC.O_NOFOLLOW);
    let key;
    try{
      const stat=await fd.stat();
      if(!stat.isFile()||stat.uid!==process.getuid()||stat.nlink!==1||
         (stat.mode&0o777)!==0o600||stat.size!==32)
        throw new Error('Unsafe original encryption key');
      key=await fd.readFile();
    }finally{await fd.close();}
    const password=secretPrompt('Existing CEO passphrase (hidden): ');
    const code=secretPrompt('Fresh 6-digit authenticator code (hidden): ');
    const activated=await activatePendingLocalOwner(pool,{
      operator,password,totpCode:code,key
    });
    console.log('CEO account:',activated.status.toUpperCase());
    console.log('One Owner sign-in now covers the assigned Direction and Support mailboxes.');
  }else{
    if(!process.stdin.isTTY||!process.stderr.isTTY)
      throw new Error('Enrollment requires an interactive local terminal');
    if(!census.empty)
      throw new Error('Identity registry is not empty; refusing any owner bootstrap');
    console.error('This creates ONE CEO account for the current Linux user.');
    console.error('After activation, this account is used for both Direction and Support.');
    if(!await confirmation())throw new Error('Enrollment not confirmed');
    await backupDatabase();
    const key=await encryptionKey();
    const password=secretPrompt('New CEO passphrase (15+ characters): ');
    const repeated=secretPrompt('Repeat CEO passphrase: ');
    if(password!==repeated)throw new Error('Passphrases do not match');
    // Reject weak input before displaying a one-time MFA setup secret.
    if(password.length<15||password.length>200||!password.trim())
      throw new Error('Passphrase does not meet requirements');
    const totpSecret=createEnkyronTotpSecret();
    console.error('\nAdd a new 6-digit time-based entry to your authenticator app.');
    console.error('Entry label: ENKYRON CEO | issuer: AGENTRISKLAYER LTD');
    console.error('Manual setup key (PRIVATE; do not paste into chat):',totpSecret);
    const code=secretPrompt('Enter the current 6-digit authenticator code: ');
    const result=await enrollPendingLocalOwner(pool,{
      operator,password,totpSecret,totpCode:code,key,activate:true,
    });
    console.log('CEO account:',result.status.toUpperCase());
    console.log('Login name:',result.loginName);
    console.log('Workspace:',result.workspace);
    console.log('One CEO login covers assigned Direction and Support; no additional accounts created.');
  }
}catch(error){
  console.error('ENKYRON owner enrollment:',String(error?.message||'failed'));
  process.exitCode=1;
}finally{await pool.end();}
