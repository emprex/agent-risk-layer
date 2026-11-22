import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import {
  ENKYRON_UAT_MARKER,ENKYRON_ENK06_UAT_MARKER,
  ENKYRON_ENK06_UAT_DATABASE,ENKYRON_ENK05_UAT_MARKER,
  resolveEnkyronDatabase,requireEnkyronUatCommand,
  requireEnkyronUatPayload,verifyEnkyronUatDatabase
} from '../desktop/enkyron-uat-database.mjs';
import {validateBootstrapTarget}
  from '../scripts/enkyron-enk06-uat-bootstrap.mjs';
import {REQUIRED_RELATIONS,requireEnk06PreflightIdentity,
  inspectEnk06Preflight} from '../scripts/enkyron-enk06-uat-preflight.mjs';

const env={ENKYRON_UAT_DATABASE:'enkyron_uat_enk06',
  ENKYRON_UAT_GUARD:'ENK06_SYNTHETIC_ONLY'};
const target=resolveEnkyronDatabase(env);
const ID='11111111-2222-4333-8444-555555555555';

test('exact ENK-06 marker and database are required; legacy targets unchanged',()=>{
  assert.deepEqual(target,{database:ENKYRON_ENK06_UAT_DATABASE,
    uat:true,marker:ENKYRON_ENK06_UAT_MARKER});
  assert.deepEqual(resolveEnkyronDatabase({}),{database:'arl_local',uat:false});
  for(const bad of [
    {...env,ENKYRON_UAT_DATABASE:'arl_local'},
    {...env,ENKYRON_UAT_DATABASE:'postgres'},
    {...env,ENKYRON_UAT_DATABASE:'enkyron_uat_enk05'},
    {...env,ENKYRON_UAT_DATABASE:'enkyron_uat_enk03'},
    {...env,ENKYRON_UAT_DATABASE:'enkyron_uat_enk06_copy'},
    {...env,ENKYRON_UAT_GUARD:ENKYRON_UAT_MARKER},
    {...env,ENKYRON_UAT_GUARD:ENKYRON_ENK05_UAT_MARKER},
    {...env,ENKYRON_UAT_GUARD:'wrong'},
    {ENKYRON_UAT_DATABASE:env.ENKYRON_UAT_DATABASE},
    {ENKYRON_UAT_GUARD:env.ENKYRON_UAT_GUARD},
  ])assert.throws(()=>resolveEnkyronDatabase(bad),/UAT requires/);
  assert.equal(resolveEnkyronDatabase({
    ENKYRON_UAT_DATABASE:'enkyron_uat_enk03',
    ENKYRON_UAT_GUARD:ENKYRON_UAT_MARKER
  }).database,'enkyron_uat_enk03');
  assert.equal(resolveEnkyronDatabase({
    ENKYRON_UAT_DATABASE:'enkyron_uat_enk05',
    ENKYRON_UAT_GUARD:ENKYRON_ENK05_UAT_MARKER
  }).database,'enkyron_uat_enk05');
});

test('only local dossier readers and exactly one reviewed write are allowed',()=>{
  for(const command of [
    'crm-companies','crm-company-tickets','crm-company-dossier',
    'mail-local-folders','mail-local-list','mail-local-messages',
    'mail-local-company','mail-local-ticket-links',
    'mail-document-list','mail-document-links','mail-ticket-conversations',
    'mail-attachment-options','mail-dossier-file'
  ])assert.doesNotThrow(()=>requireEnkyronUatCommand(target,command),command);
  for(const command of [
    'mail-attachment-quarantine','mail-attachment-preview',
    'mail-attachment-binary','mail-local-full-text','mail-local-fetch',
    'mail-local-sync','mail-local-sync-bodies','mail-local-archive-sync',
    'mail-send-draft','mail-reply-draft','mail-local-company-link',
    'mail-local-ticket-link','mail-document-link','mail-local-read',
    'mail-local-move','mail-trash-clear','mail-record-move',
    'calendar-create','crm-create-company','create-ticket',
    'crm-link-ticket','assessment-link','static-batch-commit',
    'pilot-lab-handoff','operator-profile-save',
    'psa-create-mission','unknown-future-action',
  ]){
    assert.throws(()=>requireEnkyronUatCommand(target,command),/blocks/,command);
    assert.throws(()=>requireEnkyronUatPayload(target,command,{}),/denied/,command);
  }
  for(const bad of [
    {database:ENKYRON_ENK06_UAT_DATABASE,uat:true},
    {database:ENKYRON_ENK06_UAT_DATABASE,uat:true,marker:ENKYRON_UAT_MARKER},
  ])assert.throws(()=>requireEnkyronUatCommand(bad,'mail-dossier-file'),/blocks/);
});

test('ENK-06 filing requires exact reviewed attachment or ticket, plus note',()=>{
  const request={mailbox:'direction',thread_id:ID,company_id:ID,
    ticket_id:ID,review_note:'Explicitly reviewed synthetic dossier association.',
    confirmed:true};
  assert.doesNotThrow(()=>
    requireEnkyronUatPayload(target,'mail-dossier-file',request)
  );
  for(const change of [
    {confirmed:false},{mailbox:'all'}, {thread_id:'bad'},
    {company_id:'bad'},{ticket_id:null},{review_note:'short'},
    {review_note:'a'.repeat(1001)}, {review_note:null}
  ]){
    assert.throws(()=>requireEnkyronUatPayload(target,'mail-dossier-file',{
      ...request,...change
    }),/reviewed synthetic references/);
  }
  assert.doesNotThrow(()=>requireEnkyronUatPayload(target,
    'mail-dossier-file',{...request,ticket_id:null,attachment_id:ID}));
});

test('ENK-06 SQL guard checks exact database and marker before business operation',async()=>{
  let n=0;
  await verifyEnkyronUatDatabase({async query(sql,args){
    n++;
    assert.match(sql,/enkyron_uat_guard/);
    assert.deepEqual(args,[ENKYRON_ENK06_UAT_MARKER]);
    return {rows:[{database:ENKYRON_ENK06_UAT_DATABASE,verified:true}]};
  }},target);
  assert.equal(n,1);
  for(const row of [
    {database:'arl_local',verified:true},
    {database:ENKYRON_ENK06_UAT_DATABASE,verified:false},
    {database:'enkyron_uat_enk05',verified:true}
  ])await assert.rejects(()=>verifyEnkyronUatDatabase({
    async query(){return {rows:[row]};}
  },target),/not verified/);
  await assert.rejects(()=>verifyEnkyronUatDatabase({
    async query(){throw Error('relation does not exist');}
  },target),/does not exist/);
});

test('bootstrap accepts only fresh operator-owned exact synthetic database',()=>{
  const identity={database:ENKYRON_ENK06_UAT_DATABASE,
    role:os.userInfo().username,owner:os.userInfo().username};
  assert.doesNotThrow(()=>validateBootstrapTarget(target,identity,[]));
  for(const invalid of [
    [{...target,database:'arl_local'},identity,[]],
    [{...target,marker:ENKYRON_UAT_MARKER},identity,[]],
    [target,{...identity,database:'arl_local'},[]],
    [target,{...identity,owner:'someone-else'},[]],
    [target,identity,[{schemaname:'public',tablename:'customer'}]],
    [target,identity,null],
  ])assert.throws(()=>validateBootstrapTarget(...invalid),/Refusing/);
});

test('preflight requires exact read-only peer owner, port and all schemas',async()=>{
  const identity={database:ENKYRON_ENK06_UAT_DATABASE,
    role:os.userInfo().username,owner:os.userInfo().username,
    read_only:'on',port:'5432'};
  assert.doesNotThrow(()=>requireEnk06PreflightIdentity(target,identity));
  for(const bad of [
    {...identity,database:'arl_local'}, {...identity,owner:'other'},
    {...identity,read_only:'off'}, {...identity,port:'5433'}
  ])assert.throws(()=>requireEnk06PreflightIdentity(target,bad),/Refusing/);
  const statements=[];
  const pool={async query(sql,params){
    statements.push({sql,params});
    if(sql.includes('enkyron_uat_guard'))
      return {rows:[{database:ENKYRON_ENK06_UAT_DATABASE,verified:true}]};
    if(sql.includes('pg_database'))return {rows:[identity]};
    if(sql.includes('unnest'))return {rows:REQUIRED_RELATIONS.map(
      identifier=>({identifier,present:true})
    )};
    throw Error('Unexpected preflight SQL');
  }};
  const good=await inspectEnk06Preflight(pool,target);
  assert.equal(good.read_only,true);
  assert.equal(good.checked_relations,REQUIRED_RELATIONS.length);
  assert.ok(statements.every(x=>x.sql.startsWith('SELECT ')));
  assert.deepEqual(statements.at(-1).params,[REQUIRED_RELATIONS]);

  await assert.rejects(()=>inspectEnk06Preflight({
    async query(sql){
      if(sql.includes('enkyron_uat_guard'))
        return {rows:[{database:ENKYRON_ENK06_UAT_DATABASE,verified:true}]};
      if(sql.includes('pg_database'))return {rows:[identity]};
      return {rows:REQUIRED_RELATIONS.map(
        identifier=>({identifier,present:identifier!==REQUIRED_RELATIONS[0]})
      )};
    }
  },target),/missing schema objects/);
});
