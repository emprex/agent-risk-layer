#!/usr/bin/env node
// ENK-06: ONE explicit command to prepare a NEW synthetic-only PostgreSQL UAT.
// Never connect to or migrate arl_local, never inspect customer records.
// Refuses any already existing UAT DB (no drop, cleanup, reset or overwrite).
// Run only on authorised operator Debian, without sudo; human UAT is separate.
import os from 'node:os';
import pg from 'pg';
import {resolveEnkyronDatabase,ENKYRON_ENK06_UAT_DATABASE,
  ENKYRON_ENK06_UAT_MARKER} from '../desktop/enkyron-uat-database.mjs';
import {bootstrapUat} from './enkyron-enk06-uat-bootstrap.mjs';
import {seedUat} from './enkyron-enk06-uat-seed.mjs';
import {inspectEnk06Preflight} from './enkyron-enk06-uat-preflight.mjs';

const DB=ENKYRON_ENK06_UAT_DATABASE;
const GUARD=ENKYRON_ENK06_UAT_MARKER;
const HOST='/var/run/postgresql';
const PORT=5432;

export function requireFreshEnk06Database(identity,matching,actor){
  if(!/^[A-Za-z0-9_.-]{1,80}$/.test(actor||'') ||
     identity?.database!=='postgres' ||
     identity.role!==actor ||identity.port!=='5432' ||
     !Array.isArray(matching) ||matching.length!==0)
    throw Error('Refusing ENK-06 prepare: peer postgres identity invalid or UAT database exists');
}
export function requirePrepareEnvironment(env){
  if(Object.hasOwn(env,'ENKYRON_UX_PREVIEW_READ_ONLY')||
     (Object.hasOwn(env,'ENKYRON_UAT_DATABASE')&&
      env.ENKYRON_UAT_DATABASE!==DB)||
     (Object.hasOwn(env,'ENKYRON_UAT_GUARD')&&
      env.ENKYRON_UAT_GUARD!==GUARD))
    throw Error('Refusing ENK-06 prepare: conflicting UAT or preview environment');
}
export async function prepare(){
  requirePrepareEnvironment(process.env);
  const actor=os.userInfo().username;
  if(!/^[A-Za-z0-9_.-]{1,80}$/.test(actor))
    throw Error('Refusing ENK-06 prepare: invalid operator identity');

  // Maintenance connection is ONLY to the built-in postgres database.
  // We do not query, copy, or modify arl_local. Quoted, validated identifiers
  // and parameterised existence checks rule out SQL/connection redirection.
  const maintenance=new pg.Pool({
    host:HOST,port:PORT,user:actor,database:'postgres',max:1,
    connectionTimeoutMillis:5000,options:'-c statement_timeout=8000'
  });
  try{
    const identity=(await maintenance.query(
      "SELECT current_database() AS database,current_user AS role,"+
      "current_setting('port') AS port"
    )).rows[0];
    const matching=(await maintenance.query(
      'SELECT datname FROM pg_database WHERE datname=$1',[DB]
    )).rows;
    requireFreshEnk06Database(identity,matching,actor);

    // This is the only DDL on the maintenance connection. No automatic
    // DROP DATABASE even if the later migration/seed fails.
    const quote=name=>'"'+name.replaceAll('"','""')+'"';
    await maintenance.query(
      'CREATE DATABASE '+quote(DB)+' OWNER '+quote(actor)+
      ' TEMPLATE template0 ENCODING \'UTF8\''
    );
  }finally{
    await maintenance.end();
  }

  // Both steps independently enforce exact synthetic DB, peer owner, marker,
  // no existing tables/business rows; any failure leaves a synthetic-only DB
  // for explicit inspection, never cleans up or retries uncertain writes.
  process.env.ENKYRON_UAT_DATABASE=DB;
  process.env.ENKYRON_UAT_GUARD=GUARD;
  const target=resolveEnkyronDatabase();
  if(target.database!==DB||target.uat!==true||target.marker!==GUARD)
    throw Error('Refusing ENK-06 prepare: marker resolution mismatch');
  const bootstrap=await bootstrapUat();
  const seed=await seedUat();
  const pool=new pg.Pool({host:HOST,port:PORT,user:actor,database:DB,max:1,
    connectionTimeoutMillis:5000,
    options:'-c default_transaction_read_only=on -c statement_timeout=8000'});
  try{
    const preflight=await inspectEnk06Preflight(pool,target);
    return {database:DB,guard:GUARD,created:true,
      migrations:bootstrap.migrations,seeded:seed.seeded,
      company:seed.company,ticket_number:seed.ticket_number,
      preflight,live_customer_database_untouched:true,
      next:'node scripts/enkyron-enk06-uat-launch.mjs'};
  }finally{await pool.end();}
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  if(process.argv.length!==3||process.argv[2]!=='--apply'){
    console.error('Usage: node scripts/enkyron-enk06-uat-prepare.mjs --apply');
    process.exitCode=2;
  }else prepare().then(result=>console.log(JSON.stringify(result,null,2)))
    .catch(error=>{
      console.error('ENK-06 synthetic prepare refused/failed: '+
        String(error?.message||'unknown'));
      process.exitCode=1;
    });
}
