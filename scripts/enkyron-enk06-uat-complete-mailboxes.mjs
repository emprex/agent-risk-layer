#!/usr/bin/env node
// One-time correction of an ENK-06 synthetic fixture created before Support
// mailbox was included. Only ADD an explicit read/no-send Support ACL row.
// This does not change any real Mail permissions or touch arl_local.
import os from 'node:os';
import pg from 'pg';
import {
  resolveEnkyronDatabase, verifyEnkyronUatDatabase,
  ENKYRON_ENK06_UAT_DATABASE,ENKYRON_ENK06_UAT_MARKER
} from '../desktop/enkyron-uat-database.mjs';
import {inspectEnk06Preflight} from './enkyron-enk06-uat-preflight.mjs';
import {verifySyntheticSeed} from './enkyron-enk06-uat-launch.mjs';

const DB=ENKYRON_ENK06_UAT_DATABASE;
const MARKER=ENKYRON_ENK06_UAT_MARKER;

export function requireMailboxCompletionTarget(target,identity,actor,existing){
  if(!target || target.database!==DB || target.uat!==true ||
      target.marker!==MARKER ||
      !/^[A-Za-z0-9_.-]{1,80}$/.test(actor||'') ||
      identity?.database!==DB || identity.role!==actor ||
      identity.owner!==actor || identity.port!=='5432' ||
      identity.read_only!=='off')
    throw Error('Refusing ENK-06 synthetic mailbox completion: wrong DB/role/owner');
  if(existing && (existing.role!=='organization_owner_l5' ||
      existing.can_read!==true || existing.can_send!==false))
    throw Error('Refusing ENK-06 synthetic mailbox completion: unexpected Support ACL');
}
export async function completeSyntheticMailboxes(){
  const existing=process.env;
  if(Object.hasOwn(existing,'ENKYRON_UX_PREVIEW_READ_ONLY') ||
      (Object.hasOwn(existing,'ENKYRON_UAT_DATABASE') &&
       existing.ENKYRON_UAT_DATABASE!==DB) ||
      (Object.hasOwn(existing,'ENKYRON_UAT_GUARD') &&
       existing.ENKYRON_UAT_GUARD!==MARKER))
    throw Error('Refusing ENK-06 synthetic mailbox completion: inherited UAT environment');
  process.env.ENKYRON_UAT_DATABASE=DB;
  process.env.ENKYRON_UAT_GUARD=MARKER;
  const target=resolveEnkyronDatabase();
  const actor=os.userInfo().username;
  const base={host:'/var/run/postgresql',port:5432,
    user:actor,database:DB,max:1,connectionTimeoutMillis:5000};
  // Read-only proof of the exact known synthetic fixture precedes all writes.
  const ro=new pg.Pool({...base,
    options:'-c default_transaction_read_only=on -c statement_timeout=8000'});
  try{
    await inspectEnk06Preflight(ro,target);
    await verifyEnkyronUatDatabase(ro,target);
    await verifySyntheticSeed(ro,actor,{allowMissingSupport:true});
  }finally{await ro.end();}
  const pool=new pg.Pool({...base,
    options:'-c statement_timeout=8000 -c lock_timeout=3000'});
  try{
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      try{
        const identity=(await client.query(
          'SELECT current_database() AS database,current_user AS role,'+
          'pg_get_userbyid(datdba) AS owner,'+
          "current_setting('port') AS port,"+
          "current_setting('transaction_read_only') AS read_only "+
          'FROM pg_database WHERE datname=current_database()'
        )).rows[0];
        await verifyEnkyronUatDatabase(client,target);
        const key='local:'+actor;
        const before=(await client.query(
          'SELECT role,can_read,can_send FROM enkyron_local_mail_access '+
          "WHERE workspace_key=$1 AND mailbox_key='support' FOR UPDATE",
          [key]
        )).rows[0];
        requireMailboxCompletionTarget(target,identity,actor,before);
        if(!before){
          await client.query(
            'INSERT INTO enkyron_local_mail_access '+
            '(workspace_key,mailbox_key,role,can_read,can_send,granted_by) '+
            "VALUES($1,'support','organization_owner_l5',true,false,$2)",
            [key,actor]
          );
        }
        const after=(await client.query(
          'SELECT role,can_read,can_send FROM enkyron_local_mail_access '+
          "WHERE workspace_key=$1 AND mailbox_key='support'",
          [key]
        )).rows[0];
        requireMailboxCompletionTarget(target,identity,actor,after);
        if(!after)throw Error('ENK-06 Support mailbox write missing');
        await client.query('COMMIT');
        return {database:DB,mailboxes:['direction','support'],
          provider_sends_disabled:true,updated:!before};
      }catch(error){
        await client.query('ROLLBACK').catch(()=>{});
        throw error;
      }
    }finally{client.release();}
  }finally{await pool.end();}
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  if(process.argv.length!==3||process.argv[2]!=='--apply'){
    console.error('ENK-06 synthetic mailbox completion requires --apply');
    process.exitCode=2;
  }else completeSyntheticMailboxes()
    .then(data=>console.log(JSON.stringify(data,null,2)))
    .catch(error=>{
      console.error('ENK-06 synthetic mailbox completion refused: '+
        String(error?.message||'unknown'));
      process.exitCode=1;
    });
}
