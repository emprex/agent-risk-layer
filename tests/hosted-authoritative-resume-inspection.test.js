import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HOSTED_RESUME_INSPECTION_SCHEMA,
  hostedResumeInspectionMarker
} from '../src/agent/initial-assessment-snapshot.mjs';

import {
  normaliseHostedAssessmentPreparationInput
} from '../src/agent/hosted-assessment-preparation.mjs';

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
      trust: {
        sourceCodeUploaded: false,
        matchedSecretValuesUploaded: false
      }
    }
  };
}

test(
  'hosted resume inspection is transport-safe snapshot metadata rather than caller authority',
  () => {
    const marker =
      hostedResumeInspectionMarker(
        transport()
      );

    assert.equal(
      marker.schema,
      HOSTED_RESUME_INSPECTION_SCHEMA
    );
    assert.equal(
      marker.source,
      'transport_safe_customer_inspection'
    );
    assert.equal(
      marker.transport.target.revision,
      REVISION
    );
    assert.equal(
      marker.transport.binding.verified,
      true
    );

    const withoutCallerInspection =
      normaliseHostedAssessmentPreparationInput(
        {}
      );

    assert.equal(
      withoutCallerInspection.frozenInspection,
      null
    );

    const withCallerInspection =
      normaliseHostedAssessmentPreparationInput({
        frozenInspection: transport()
      });

    assert.equal(
      withCallerInspection
        .frozenInspection.target.revision,
      REVISION
    );

    assert.throws(
      () =>
        normaliseHostedAssessmentPreparationInput({
          projectId: 'caller-must-not-set-this'
        }),
      (error) =>
        error?.code ===
        'HOSTED_ASSESSMENT_AUTHORITY_FIELD_REJECTED'
    );
  }
);
