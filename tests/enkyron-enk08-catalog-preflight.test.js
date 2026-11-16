import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {reviewEnk08Catalog}
  from '../scripts/enkyron-enk08-catalog-preflight.mjs';

const columns = [
  ['enkyron_crm_companies','id','text'],
  ['enkyron_crm_companies','workspace_key','text'],
  ['enkyron_crm_companies','name','text'],
  ['enkyron_crm_opportunities','id','text'],
  ['enkyron_crm_opportunities','workspace_key','text'],
  ['enkyron_crm_opportunities','company_id','text'],
].map(([table_name,column_name,data_type])=>({table_name,column_name,data_type}));
const tables = ['enkyron_crm_companies','enkyron_crm_opportunities'];
const constraints = [
  {table_name:'enkyron_crm_companies',constraint_type:'u',
    definition:'UNIQUE (workspace_key, id)'},
  {table_name:'enkyron_crm_opportunities',constraint_type:'f',
    definition:'FOREIGN KEY (workspace_key, company_id) REFERENCES enkyron_crm_companies(workspace_key, id) ON DELETE RESTRICT'},
];
const functions = [{function_name:'enkyron_crm_events_immutable',result_type:'trigger'}];
const audit = (c=columns,t=tables,k=constraints,f=functions) =>
  reviewEnk08Catalog(c,t,k,f);

test('ENK-08 audit: compatible synthetic CRM catalog is NOT a release approval',()=>{
  const r=audit();
  assert.equal(r.crm_catalog_compatible_for_draft_review,true);
  assert.equal(r.release_approved,false);
  assert.deepEqual(r.issues,[]);
  assert.equal(r.customer_records_read,false);
  assert.equal(r.migration_executed,false);
});

test('ENK-08 audit: missing company constraint is a STOP',()=>{
  const r=audit(columns,tables,constraints.slice(1));
  assert.equal(r.crm_catalog_compatible_for_draft_review,false);
  assert.match(r.issues.join(' '),/uniqueness missing/);
});

test('ENK-08 audit: missing opportunity scoped foreign key is a STOP',()=>{
  const r=audit(columns,tables,constraints.slice(0,1));
  assert.equal(r.crm_catalog_compatible_for_draft_review,false);
  assert.match(r.issues.join(' '),/scoped FK missing/);
});

test('ENK-08 audit: missing immutable audit trigger is a STOP',()=>{
  const r=audit(columns,tables,constraints,[]);
  assert.equal(r.crm_catalog_compatible_for_draft_review,false);
  assert.match(r.issues.join(' '),/trigger function missing/);
});

test('ENK-08 audit: CRM wrong column type or missing company fails closed',()=>{
  const wrong=columns.map(row=>row.column_name==='company_id'?{...row,data_type:'uuid'}:row);
  const r=audit(wrong,tables,constraints,functions);
  assert.equal(r.crm_catalog_compatible_for_draft_review,false);
  assert.match(r.issues.join(' '),/company_id/);
  assert.match(audit(columns,tables.slice(1),constraints,functions).issues.join(' '),
    /missing CRM table/);
});

test('ENK-08 audit: unexpected existing PSA draft tables block compatibility',()=>{
  const r=audit(columns,[...tables,'enkyron_psa_missions'],constraints,functions);
  assert.equal(r.crm_catalog_compatible_for_draft_review,false);
  assert.deepEqual(r.existing_psa_tables,['enkyron_psa_missions']);
});

test('ENK-08 audit: malformed/duplicate catalog input is rejected',()=>{
  assert.throws(()=>audit(null,tables,constraints,functions),/invalid catalog/);
  assert.throws(()=>audit([...columns,columns[0]],tables,constraints,functions),/duplicate/);
  assert.throws(()=>audit([{table_name:2}],tables,constraints,functions),/malformed/);
});

test('ENK-08 audit: exact local peer connection and read-only transaction are mandatory',()=>{
  const s=readFileSync(new URL('../scripts/enkyron-enk08-catalog-preflight.mjs',import.meta.url),'utf8');
  assert.match(s,/host:\s*'\/var\/run\/postgresql'/);
  assert.match(s,/database:\s*'arl_local'/);
  assert.match(s,/port:\s*5432/);
  assert.match(s,/BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/);
  assert.match(s,/default_transaction_read_only=on/);
  assert.match(s,/identity\?\.database !== 'arl_local'/);
  assert.match(s,/release_approved:\s*false/);
  assert.match(s,/process\.exitCode = 2; \/\/ The live migration\/authorization gate is STOP/);
  assert.doesNotMatch(s,/runMigrations\s*\(/);
  assert.doesNotMatch(s,/process\.env\.DATABASE_URL/);
});
