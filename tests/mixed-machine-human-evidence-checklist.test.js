import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validateCanonicalManualEvidenceChecklist
} from '../src/agent/manual-evidence-checklist.mjs';

function workflowState({
  automaticEvidenceCollected = true,
  activeTestRequirements = []
} = {}) {
  return {
    evidenceWorkQueue: {
      items: [
        {
          controlId: 'ARL-KB-004',
          requiredEvidence: [
            'ARL-KB-004 exact assessed system, version, environment, scope and declared risk tier',
            'ARL-KB-004 accountable human reviewer identity, role, timestamp, decision and evidence digest'
          ],
          machineCollectableRequirements: [
            'ARL-KB-004 exact assessed system, version, environment, scope and declared risk tier'
          ],
          humanOnlyRequirements: [
            'ARL-KB-004 accountable human reviewer identity, role, timestamp, decision and evidence digest'
          ],
          activeTestRequirements,
          automaticEvidenceCollected
        }
      ]
    }
  };
}

function manualEvidence() {
  return {
    result: 'passed',
    observedResult:
      'Accountable reviewer confirmed the version-bound classification decision.',
    evidenceChecklist: [
      {
        requirement:
          'ARL-KB-004 accountable human reviewer identity, role, timestamp, decision and evidence digest',
        evidenceReference:
          'human-review:ARL-KB-004',
        observation:
          'Reviewer identity, role, timestamp, decision and evidence digest are recorded.',
        satisfied: true
      }
    ]
  };
}

test('mixed evidence review requires only the remaining human-only canonical checklist after machine evidence was collected', () => {
  const result =
    validateCanonicalManualEvidenceChecklist({
      manualEvidence: manualEvidence(),
      workflowState: workflowState(),
      controlId: 'ARL-KB-004'
    });

  assert.equal(
    result.canonicalChecklistVerified,
    true
  );
  assert.match(
    result.observedResult,
    /Canonical human-only evidence checklist/
  );
  assert.doesNotMatch(
    result.observedResult,
    /exact assessed system, version, environment, scope and declared risk tier/
  );
});

test('mixed evidence review fails closed when required machine evidence has not been collected', () => {
  assert.throws(
    () =>
      validateCanonicalManualEvidenceChecklist({
        manualEvidence: manualEvidence(),
        workflowState: workflowState({
          automaticEvidenceCollected: false
        }),
        controlId: 'ARL-KB-004'
      }),
    /machine evidence has not yet been collected/
  );
});

test('manual conclusion is blocked while active or runtime evidence is still required', () => {
  assert.throws(
    () =>
      validateCanonicalManualEvidenceChecklist({
        manualEvidence: manualEvidence(),
        workflowState: workflowState({
          activeTestRequirements: [
            'Bounded negative evidence showing prohibited action denial before side effects'
          ]
        }),
        controlId: 'ARL-KB-004'
      }),
    /active or runtime evidence is still required/
  );
});
