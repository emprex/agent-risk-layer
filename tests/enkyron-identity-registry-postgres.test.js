import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';

const url=process.env.ARL_CI_POSTGRES_URL||'';
function syntheticCI(){
  assert.equal(process.env.CI,'true','Only the disposable CI database is writable');
  const parsed=new URL(url);
  assert.equal(parsed.hostname,'127.0.0.1');
  assert.equal(parsed.pathname,'/arl_ci');
  assert.equal(parsed.username,'arl_ci');
  assert.equal(parsed.password,'synthetic-ci-only');
  assert.equal(parsed.search,'');
  return url;
}
test('UX-15B1 migration 108 adds only a dormant identity registry',async()=>{
  const sql=await readFile(new URL('../migrations/108_enkyron_identity_registry.sql',import.meta.url),'utf8');
  const script=await readFile(new URL('../scripts/enkyron-identity-schema.mjs',import.meta.url),'utf8');
  assert.match(sql,/CREATE TABLE enkyron_identity_people/);
  assert.match(sql,/CREATE TABLE enkyron_identity_principals/);
  assert.match(sql,/CREATE TABLE enkyron_identity_status_events/);
  assert.match(sql,/CREATE VIEW enkyron_identity_principal_effective/);
  assert.doesNotMatch(sql,/INSERT\s+INTO\s+enkyron_identity_/i);
  assert.doesNotMatch(sql,/ALTER\s+TABLE\s+(arl_workbench|enkyron_crm|enkyron_operator_personal_profiles)/i);
  assert.match(script,/--check/);
  assert.match(script,/--apply/);
  assert.match(script,/pg_dump/);
  assert.match(script,/pg_restore/);
  assert.match(script,/108_enkyron_identity_registry\.sql/);
});

test('UX-15B1 real CI PostgreSQL allows two dormant principals for one person, never mutates history',{
  skip:!url&&'Disposable PostgreSQL only',timeout:45000
},async()=>{
  const pool=new pg.Pool({connectionString:syntheticCI(),max:2});
  const id=()=>randomUUID();
  const person=id(),owner=id(),developer=id(),org='org-'+id().slice(0,8);
  const workspace='local:ci-'+id().slice(0,8);
  const addPrincipal=async(principal,who,role,personId=person,organizationId=org)=>
    pool.query('INSERT INTO enkyron_identity_principals '
      +'(id,person_id,workspace_key,organization_id,login_name,role) '
      +'VALUES ($1,$2,$3,$4,$5,$6)',
      [principal,personId,workspace,organizationId,who,role]);
  try{
    await pool.query(
      'INSERT INTO enkyron_identity_people(id,workspace_key,organization_id) '
      +'VALUES($1,$2,$3)',[person,workspace,org]);
    await addPrincipal(owner,'synthetic-ceo','organization_owner_l5');
    await addPrincipal(developer,'synthetic-emprex','developer_privileged');
    const principals=(await pool.query(
      'SELECT id,person_id,login_name,role,effective_status FROM '
      +'enkyron_identity_principal_effective '
      +'WHERE workspace_key=$1 ORDER BY login_name',[workspace])).rows;
    assert.equal(principals.length,2);
    assert.deepEqual(principals.map(x=>x.effective_status),['pending','pending']);
    assert.ok(principals.every(x=>x.person_id===person));
    assert.notEqual(principals[0].id,principals[1].id);
    await assert.rejects(()=>addPrincipal(id(),'synthetic-ceo','developer_privileged'),/unique|duplicate/i);
    await assert.rejects(()=>addPrincipal(id(),'synthetic-extra','owner'),/check/i);
    await assert.rejects(()=>addPrincipal(id(),'synthetic-else','security_engineer_l3',person,'other-org'),/foreign key/i);
    await assert.rejects(()=>pool.query(
      'UPDATE enkyron_identity_principals SET role=$1 WHERE id=$2',
      ['service_desk_l1',owner]),/immutable|cannot be changed|not allowed/i);
    await assert.rejects(()=>pool.query(
      'DELETE FROM enkyron_identity_people WHERE id=$1',[person]),
      /immutable|cannot be changed|not allowed/i);

    // Lifecycle storage is tested on synthetic CI records only. This does
    // NOT assert an authenticated service can activate accounts yet.
    const eventId=id();
    await pool.query('INSERT INTO enkyron_identity_status_events '
      +'(id,principal_id,event_type,reason) VALUES($1,$2,$3,$4)',
      [eventId,owner,'activated','Synthetic CI event; no real authentication']);
    assert.equal((await pool.query(
      'SELECT effective_status FROM enkyron_identity_principal_effective WHERE id=$1',
      [owner])).rows[0].effective_status,'active');
    assert.equal((await pool.query(
      'SELECT effective_status FROM enkyron_identity_principal_effective WHERE id=$1',
      [developer])).rows[0].effective_status,'pending');
    await pool.query('INSERT INTO enkyron_identity_status_events '
      +'(id,principal_id,event_type,reason) VALUES($1,$2,$3,$4)',
      [id(),owner,'revoked','Synthetic CI revocation record only']);
    assert.equal((await pool.query(
      'SELECT effective_status FROM enkyron_identity_principal_effective WHERE id=$1',
      [owner])).rows[0].effective_status,'revoked');
    await assert.rejects(()=>pool.query(
      'DELETE FROM enkyron_identity_status_events WHERE id=$1',[eventId]),
      /immutable|cannot be changed|not allowed/i);
  }finally{await pool.end();}
});
