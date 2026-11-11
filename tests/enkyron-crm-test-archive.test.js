import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const archive=fs.readFileSync(path.join(root,'scripts/enkyron-clean-test-companies.mjs'),'utf8');
const crm=fs.readFileSync(path.join(root,'desktop/enkyron-crm.mjs'),'utf8');

test('test-record cleanup is archive-only, exact scoped and auditable',()=>{
  assert.match(archive,/ARL CRM Import Test 3d5a49b4/);
  assert.match(archive,/const NAMES=Object\.freeze\(\['ARL CRM Import Test 3d5a49b4','Test'\]\)/);
  assert.match(archive,/--check','--archive'/);
  assert.doesNotMatch(archive,/--remove|DELETE FROM|TRUNCATE|ON DELETE CASCADE|DROP TABLE/);
  assert.match(archive,/relationship_state='inactive'/);
  assert.match(archive,/AND record_version=\$4/);
  assert.match(archive,/enkyron_crm_record_changes/);
  assert.match(archive,/enkyron_crm_events/);
  assert.match(archive,/await verifiedBackup\(\)/);
  assert.match(archive,/await db\.query\('BEGIN'\)/);
  assert.match(archive,/await db\.query\('ROLLBACK'\)/);
  assert.match(crm,/\$2<>'' OR relationship_state<>'inactive'/);
  assert.match(crm,/ORDER BY created_at ASC,id ASC/);
});
