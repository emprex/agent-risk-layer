#!/usr/bin/env node
// Explicit first-time local Resend setup; no CLI arguments containing secrets.
// Requires a human, a private TTY, and a GET-only inbox list API call.
// Does not alter DNS, Resend inboxes, PostgreSQL, or any messages.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import {constants as C} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {
  DEFAULT_RESEND_CONFIG,loadPrivateResendConfig,
} from '../desktop/enkyron-mail-private-config.mjs';
import {OWNER_MAILBOXES} from '../desktop/enkyron-owner-mail-access.mjs';

const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
function privatePrompt(label){
  const code=[
    'import getpass,json,sys',
    's=getpass.getpass(sys.argv[1])',
    'sys.stdout.write(json.dumps(s))',
  ].join('\n');
  const p=spawnSync('python3',['-c',code,label],{
    stdio:['inherit','pipe','inherit'],encoding:'utf8',
    timeout:120000,maxBuffer:1024,
  });
  if(p.status!==0)throw new Error('Private TTY input is unavailable');
  return JSON.parse(p.stdout);
}
async function setup(){
  if(!process.stdin.isTTY||!process.stderr.isTTY)
    throw new Error('Run this on your own terminal');
  const directory=path.dirname(DEFAULT_RESEND_CONFIG);
  await fs.mkdir(directory,{recursive:true,mode:0o700});
  const st=await fs.lstat(directory);
  if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==process.getuid()
      ||(st.mode&0o077)!==0)
    throw new Error('Private Resend directory is not secure');
  try{
    await fs.lstat(DEFAULT_RESEND_CONFIG);
    throw new Error('An existing Resend connection exists; refusing to overwrite');
  }catch(e){if(e.code!=='ENOENT')throw e;}
  const apiKey=privatePrompt('Resend API key (hidden; not shared with ChatGPT): ');
  if(typeof apiKey!=='string'||!/^re_[A-Za-z0-9_-]{20,256}$/.test(apiKey))
    throw new Error('Invalid Resend key format');
  const response=await fetch('https://api.resend.com/inboxes?limit=20',{
    method:'GET',redirect:'error',signal:AbortSignal.timeout(8000),
    headers:{Authorization:'Bearer '+apiKey},
  });
  if(!response.ok)throw new Error('Resend inbox discovery failed (HTTP '+response.status+')');
  const body=await response.json();
  if(!Array.isArray(body?.data)||body.data.length>20)
    throw new Error('Unexpected Resend inbox list');
  const mapped={};
  for(const {key,address} of OWNER_MAILBOXES){
    const matches=body.data.filter(x=>
      typeof x?.email_address==='string'&&
      x.email_address.toLowerCase()===address.toLowerCase()&&
      typeof x?.id==='string'&&UUID.test(x.id)
    );
    if(matches.length!==1)throw new Error('Required inbox not found: '+address);
    mapped[key]=matches[0].id;
  }
  if(mapped.direction===mapped.support)throw new Error('Inboxes are not distinct');
  process.stderr.write('Matched Resend inboxes:\n'+
    OWNER_MAILBOXES.map(x=>'  '+x.label+': '+x.address).join('\n')+'\n');
  if(privatePrompt('Type CONNECT to save this private local configuration: ')!=='CONNECT')
    throw new Error('Setup cancelled');
  // After all checks, write once; do not overwrite or print the credential.
  const json=JSON.stringify({version:1,api_key:apiKey,mailboxes:mapped})+'\n';
  const fh=await fs.open(DEFAULT_RESEND_CONFIG,
    C.O_WRONLY|C.O_CREAT|C.O_EXCL|C.O_NOFOLLOW,0o600);
  try{
    await fh.writeFile(json);
    await fh.sync();
  }finally{await fh.close();}
  await loadPrivateResendConfig();
  process.stdout.write('Two Resend inboxes configured locally. No messages sent.\n');
}
async function main(){
  const mode=process.argv[2];
  if(process.argv.length!==3||!['--check','--connect'].includes(mode))
    throw new Error('Use --check or --connect');
  if(mode==='--check'){
    try{
      const cfg=await loadPrivateResendConfig();
      if(!cfg.mailboxes.direction||!cfg.mailboxes.support)throw new Error();
      process.stdout.write('Resend config: present, private permissions verified.\n');
    }catch{
      process.stdout.write('Resend config: not configured.\n');
      process.exitCode=2;
    }
    return;
  }
  await setup();
}
main().catch(e=>{
  const accepted=/^(Required inbox not found|An existing Resend connection exists|Use --check|Setup cancelled|Run this on your own terminal)/.test(e.message);
  console.error(accepted?e.message:'Resend setup unavailable. Check the key, inboxes and local file permissions.');
  process.exitCode=1;
});
