import test from 'node:test';
import assert from 'node:assert/strict';
import {
 CURRENT_SOURCE_PROJECTION,selectCurrentSourceProjectionArtifacts
} from '../src/agent/source-projection-selection.mjs';

test('same-scope v2 source projection replaces, never merges with, legacy evidence',()=>{
 const old={sourceProjectionRevision:'legacy_unversioned',digest:'a'.repeat(64),
  observations:[{requirement:'Old static rule',collectors:['source_and_configuration']}]};
 const current={sourceProjectionRevision:CURRENT_SOURCE_PROJECTION,digest:'b'.repeat(64),
  observations:[{requirement:'New static rule',collectors:['source_and_configuration']}]};
 assert.deepEqual(selectCurrentSourceProjectionArtifacts([old,current]),[current]);
 assert.deepEqual(selectCurrentSourceProjectionArtifacts([old]),[old]);
 assert.deepEqual(selectCurrentSourceProjectionArtifacts([]),[]);
 assert.throws(()=>selectCurrentSourceProjectionArtifacts(null),/array/);
 assert.equal(CURRENT_SOURCE_PROJECTION,'arl.source-collection-projection.v2');
});
test('append-only source revision precedence is deterministic independent of row insertion order',()=>{
 const old={sourceProjectionRevision:'legacy_unversioned',digest:'a'.repeat(64)};
 const current={sourceProjectionRevision:CURRENT_SOURCE_PROJECTION,digest:'b'.repeat(64)};
 assert.deepEqual(selectCurrentSourceProjectionArtifacts([current,old]),[current]);
 assert.deepEqual(selectCurrentSourceProjectionArtifacts([old,current]),[current]);
 // A newer projection with no matching requirement must not inherit a legacy
 // requirement observation merely because an old artifact is retained.
 assert.equal(selectCurrentSourceProjectionArtifacts([old,current]).includes(old),false);
});
