#!/usr/bin/env node
// ENK-06: initialise ONLY a fresh, empty synthetic database owned by the OS
// peer account. Never connect to, copy, migrate or drop arl_local.
import os from 'node:os';
import pg from 'pg';
import {runMigrations} from '../src/migrations.js';
import {resolveEnkyronDatabase,ENKYRON_ENK06_UAT_MARKER,
  ENKYRON_ENK06_UAT_DATABASE} from '../desktop/enkyron-uat-database.mjs';

const DB=ENKYRON_ENK06_UAT_DATABASE;

export function validateBootstrapTarget(target,identity,tables){
  if(target?.database!==DB||target?.uat!==true||
      target?.marker!==ENKYRON_ENK06_UAT_MARKER)
    throw Error('Refusing ENK-06 bootstrap: wrong database or marker');
  if(identity?.database!==DB||
      identity.role!==os.userInfo().username||
      identity.owner!==identity.role)
    throw Error('Refusing ENK-06 bootstrap: database identity or ownership differs');
  if(!Array.isArray(tables)||tables.length!==0)
    throw Error('Refusing ENK-06 bootstrap: existing tables or invalid inventory');
}
function bind(sql,args){
  let count=0;
  const mapped=sql.replace(/\?/g,()=>'$'+(++count));
  if(count!==args.length)throw Error('ENK-06 migration parameter mismatch');
  return mapped;
}
export function migrationAdapter(client){
  return {kind:'postgres',
    async exec(sql){return client.query(sql);},
    prepare(sql){return {
      async all(...args){return (await client.query(bind(sql,args),args)).rows;},
      async run(...args){return client.query(bind(sql,args),args);}
    };},
    async transaction(work){
      await client.query('BEGIN');
      try{
        const result=await work();
        await client.query(
          "CREATE TABLE public.enkyron_uat_guard "+
          "(marker TEXT PRIMARY KEY CHECK(marker='ENK06_SYNTHETIC_ONLY'))"
        );
        await client.query(
          'INSERT INTO public.enkyron_uat_guard(marker) VALUES($1)',
          [ENKYRON_ENK06_UAT_MARKER]
        );
        const row=(await client.query(
          'SELECT current_database() AS database,'+
          'EXISTS(SELECT 1 FROM public.enkyron_uat_guard WHERE marker=$1) AS verified',
          [ENKYRON_ENK06_UAT_MARKER]
        )).rows[0];
        if(row?.database!==DB||row?.verified!==true)
          throw Error('ENK-06 bootstrap marker verification failed');
        await client.query('COMMIT');
        return result;
      }catch(error){
        await client.query('ROLLBACK').catch(()=>{});
        throw error;
      }
    }
  };
}
export async function bootstrapUat(){
  const target=resolveEnkyronDatabase();
  if(target.database!==DB||target.uat!==true||
      target.marker!==ENKYRON_ENK06_UAT_MARKER)
    throw Error('Refusing ENK-06 bootstrap: exact synthetic target required');
  const pool=new pg.Pool({
    host:'/var/run/postgresql',port:5432,
    database:DB,user:os.userInfo().username,max:1,
    connectionTimeoutMillis:5000,
    options:'-c statement_timeout=180000 -c lock_timeout=5000'
  });
  try{
    const client=await pool.connect();
    try{
      const identity=(await client.query(
        'SELECT current_database() AS database,current_user AS role,'+
        'pg_get_userbyid(datdba) AS owner FROM pg_database '+
        'WHERE datname=current_database()'
      )).rows[0];
      const tables=(await client.query(
        "SELECT schemaname,tablename FROM pg_tables WHERE "+
        "schemaname !~ '^pg_' AND schemaname <> 'information_schema'"
      )).rows;
      validateBootstrapTarget(target,identity,tables);
      const result=await runMigrations(migrationAdapter(client));
      if(!result.applied.length||result.skipped.length)
        throw Error('ENK-06 UAT requires a fresh migration registry');
      return {database:DB,migrations:result.applied.length,
        last_migration:result.applied.at(-1),
        synthetic_guard:'verified',seeded:false};
    }finally{client.release();}
  }finally{await pool.end();}
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  if(process.argv.length!==3||process.argv[2]!=='--apply'){
    console.error('ENK-06 bootstrap requires explicit --apply on a fresh enkyron_uat_enk06 database');
    process.exitCode=2;
  }else bootstrapUat().then(result=>console.log(JSON.stringify(result,null,2)))
    .catch(error=>{
      console.error('ENK-06 synthetic bootstrap refused: '+
        String(error?.message||'unknown error'));
      process.exitCode=1;
    });
}
