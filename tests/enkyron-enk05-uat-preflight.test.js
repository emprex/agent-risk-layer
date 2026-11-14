import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import {
  ENKYRON_ENK05_UAT_DATABASE as DB,
  ENKYRON_ENK05_UAT_MARKER as MARKER,
  resolveEnkyronDatabase
} from '../desktop/enkyron-uat-database.mjs';
import {
  REQUIRED_RELATIONS,requireEnk05PreflightIdentity,inspectEnk05Preflight
} from '../scripts/enkyron-enk05-uat-preflight.mjs';
const target=resolveEnkyronDatabase({
  ENKYRON_UAT_DATABASE:DB,ENKYRON_UAT_GUARD:MARKER
});
function identity(changes={}) {
  return {database:DB,role:os.userInfo().username,
    owner:os.userInfo().username,read_only:'on',...changes};
}
test('read-only ENK-05 preflight requires exact target, peer owner, read-only mode',()=>{
  assert.doesNotThrow(()=>requireEnk05PreflightIdentity(target,identity()));
  for(const row of [
    identity({database:'arl_local'}),
    identity({owner:'postgres'}),
    identity({role:'different'}),
    identity({read_only:'off'})
  ]) assert.throws(()=>requireEnk05PreflightIdentity(target,row),/Refusing/);
  assert.throws(()=>requireEnk05PreflightIdentity({
    database:'enkyron_uat_enk03',uat:true},identity()),/Refusing/);
});
test('read-only ENK-05 preflight verifies marker and only reads schema metadata',async()=>{
  let count=0;
  const pool={async query(sql,args){
    count++;
    assert.match(sql,/SELECT/);
    assert.doesNotMatch(sql,/INSERT|UPDATE|DELETE|CREATE|DROP|ALTER/i);
    if(count===1){
      assert.deepEqual(args,[MARKER]);
      return {rows:[{database:DB,verified:true}]};
    }
    if(count===2)return {rows:[identity()]};
    assert.deepEqual(args,[REQUIRED_RELATIONS]);
    return {rows:REQUIRED_RELATIONS.map(identifier=>({identifier,present:true}))};
  }};
  const result=await inspectEnk05Preflight(pool,target);
  assert.equal(count,3);
  assert.equal(result.synthetic_guard,'verified');
  assert.equal(result.read_only,true);
  assert.match(result.note,/NOT_RUN/);
});
test('ENK-05 preflight rejects missing tables or invalid markers',async()=>{
  const fake=(marker,missing)=>({async query(sql,args){
    if(sql.includes('enkyron_uat_guard'))return {rows:[{database:DB,verified:marker}]};
    if(sql.includes('current_setting'))return {rows:[identity()]};
    return {rows:REQUIRED_RELATIONS.map((identifier,i)=>({
      identifier,present:!missing||i!==0
    }))};
  }});
  await assert.rejects(()=>inspectEnk05Preflight(fake(false,false),target),/not verified/);
  await assert.rejects(()=>inspectEnk05Preflight(fake(true,true),target),/missing required tables/);
});
