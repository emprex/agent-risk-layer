import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RESUME_INSPECTION_SCHEMA,
  resumeInspectionMarker
} from '../src/agent/initial-assessment-snapshot.mjs';

const REVISION =
  'd73aa9021f86ac1e256a2ca8e2e1679ef663fe32';

function transport() {
  return {
    schema:
      'arl.agent.frozen-inspection-transport.v1',
    type: 'frozen_inspection_transport',
    target: {
      source: 'local_git',
      revision: REVISION,
      dirty: false
    },
    binding: {
      verified: true,
      revisionBefore: REVISION,
      revisionAfter: REVISION
    },
    inspection: {
      findings: [],
      observations: [],
      scope: {
        gitHistorySecretScan: true
      },
      trust: {
        sourceCodeUploaded: false,
        matchedSecretValuesUploaded: false
      }
    }
  };
}

test('resume inspection marker is transport-safe local snapshot metadata', () => {
  const marker =
    resumeInspectionMarker(transport());

  assert.equal(
    marker.schema,
    RESUME_INSPECTION_SCHEMA
  );
  assert.equal(
    marker.source,
    'transport_safe_snapshot_projection'
  );
  assert.equal(
    marker.transport.target.revision,
    REVISION
  );
  assert.equal(
    marker.transport.binding.verified,
    true
  );
  assert.equal(
    marker.transport.inspection.observed,
    true
  );
  assert.match(
    marker.sourceInspectionDigest,
    /^[a-f0-9]{64}$/
  );
  assert.equal(
    JSON.stringify(marker).includes(
      'gitHistorySecretScan'
    ),
    false
  );
  assert.equal(
    JSON.stringify(marker).includes(
      '"scope"'
    ),
    false
  );
});
