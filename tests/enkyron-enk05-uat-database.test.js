import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import {
  ENKYRON_UAT_MARKER, ENKYRON_ENK05_UAT_MARKER,
  ENKYRON_ENK05_UAT_DATABASE, resolveEnkyronDatabase,
  requireEnkyronUatCommand, requireEnkyronUatPayload,
  verifyEnkyronUatDatabase
} from '../desktop/enkyron-uat-database.mjs';
import {validateBootstrapTarget} from '../scripts/enkyron-enk05-uat-bootstrap.mjs';

const env={
  ENKYRON_UAT_DATABASE:ENKYRON_ENK05_UAT_DATABASE,
  ENKYRON_UAT_GUARD:ENKYRON_ENK05_UAT_MARKER
};
const target=resolveEnkyronDatabase(env);

test('ENK-05 selects only exact dedicated synthetic DB and marker',()=>{
  assert.deepEqual(target,{database:'enkyron_uat_enk05',uat:true,
    marker:'ENK05_SYNTHETIC_ONLY'});
  assert.deepEqual(resolveEnkyronDatabase({}),{database:'arl_local',uat:false});
  assert.deepEqual(resolveEnkyronDatabase({
    ENKYRON_UAT_DATABASE:'enkyron_uat_enk03',
    ENKYRON_UAT_GUARD:ENKYRON_UAT_MARKER
  }),{database:'enkyron_uat_enk03',uat:true});
  for(const bad of [
    {...env,ENKYRON_UAT_DATABASE:'arl_local'},
    {...env,ENKYRON_UAT_DATABASE:'enkyron_uat_enk03'},
    {...env,ENKYRON_UAT_DATABASE:'enkyron_uat_enk05_copy'},
    {...env,ENKYRON_UAT_GUARD:'wrong'},
    {ENKYRON_UAT_DATABASE:env.ENKYRON_UAT_DATABASE},
    {ENKYRON_UAT_GUARD:env.ENKYRON_UAT_GUARD}
  ]) assert.throws(()=>resolveEnkyronDatabase(bad),/UAT requires/);
});

test('ENK-05 permits bounded Service Desk and canonical company link only',()=>{
  for(const command of [
    'tickets','tickets-archived','tickets-mine','tickets-mine-archived',
    'ticket','create-ticket','ticket-status','ticket-assignment',
    'ticket-archive','ticket-triage-save','ticket-actions',
    'ticket-action-save','note','crm-companies','crm-create-company',
    'crm-company-dossier','crm-company-history','crm-company-tickets',
    'crm-ticket-options','crm-ticket-company','crm-link-ticket'
  ]){
    assert.doesNotThrow(()=>requireEnkyronUatCommand(target,command),command);
    assert.doesNotThrow(()=>requireEnkyronUatPayload(target,command,null),command);
  }
  for(const command of [
    'mail-send-draft','mail-threads','mail-local-sync','calendar-create',
    'crm-invoice-issue','crm-mail-manual-send','assessment-link','master',
    'pilot-lab-handoff','static-batch-commit','crm-company-proposal-revise',
    'crm-csv-import-commit','operator-profile-save','unknown-future-command'
  ]){
    assert.throws(()=>requireEnkyronUatCommand(target,command),/blocks/);
    assert.throws(()=>requireEnkyronUatPayload(target,command,{}),/denied/);
  }
  assert.throws(()=>requireEnkyronUatCommand(
    {database:ENKYRON_ENK05_UAT_DATABASE,uat:true},'create-ticket'),/blocks/);
});

test('ENK-03 accepted R1/R2 remains write-blocked for ENK-05 commands',()=>{
  const old=resolveEnkyronDatabase({
    ENKYRON_UAT_DATABASE:'enkyron_uat_enk03',
    ENKYRON_UAT_GUARD:ENKYRON_UAT_MARKER
  });
  for(const command of ['create-ticket','ticket-status','ticket-assignment',
    'ticket-triage-save','ticket-action-save','crm-link-ticket','note']){
    assert.throws(()=>requireEnkyronUatCommand(old,command),/UAT blocks/);
  }
});

test('ENK-05 marker is checked on exact database before any operation',async()=>{
  let calls=0;
  await verifyEnkyronUatDatabase({async query(sql,args){
    calls++;
    assert.match(sql,/enkyron_uat_guard/);
    assert.deepEqual(args,[ENKYRON_ENK05_UAT_MARKER]);
    return {rows:[{database:ENKYRON_ENK05_UAT_DATABASE,verified:true}]};
  }},target);
  assert.equal(calls,1);
  for(const row of [
    {database:'arl_local',verified:true},
    {database:'enkyron_uat_enk03',verified:true},
    {database:ENKYRON_ENK05_UAT_DATABASE,verified:false}
  ]) await assert.rejects(()=>verifyEnkyronUatDatabase({
    async query(){return {rows:[row]};}
  },target),/not verified/);
});

test('ENK-05 bootstrap only accepts fresh owned dedicated DB',()=>{
  const identity={
    database:ENKYRON_ENK05_UAT_DATABASE,
    role:os.userInfo().username,owner:os.userInfo().username
  };
  assert.doesNotThrow(()=>validateBootstrapTarget(target,identity,[]));
  for(const [other,who,tables] of [
    [{database:'arl_local',uat:false},identity,[]],
    [{database:ENKYRON_ENK05_UAT_DATABASE,uat:true},identity,[]],
    [target,{...identity,owner:'postgres'},[]],
    [target,identity,[{schemaname:'public',tablename:'existing_data'}]]
  ]) assert.throws(()=>validateBootstrapTarget(other,who,tables),/Refusing bootstrap/);
});
