import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAccreditationReadinessProjection
} from '../src/agent/accreditation-readiness.mjs';

test('accreditation readiness is explicitly non-claiming and separates product from organisational evidence', () => {
  const projection =
    buildAccreditationReadinessProjection({
      workflowState: {
        authoritativeArtifacts: {
          frozenTarget: {
            revision:
              'b3116fcfcec3bf6967773c3e9587c502b1fed5e5'
          },
          bindings: {
            assessmentContextVerified: true
          },
          controlIntelligence: {
            available: true
          }
        },
        humanReviewRequired: true
      }
    });

  assert.equal(projection.available, true);
  assert.equal(
    projection.candidateRoute.candidateStandard,
    'ISO/IEC 17020:2026'
  );
  assert.equal(
    projection.candidateRoute.status,
    'candidate_route_not_confirmed'
  );
  assert.equal(
    projection.summary.accreditationClaimPermitted,
    false
  );
  assert.equal(
    projection.summary.certificationClaimPermitted,
    false
  );
  assert.equal(
    projection.technicalReferences
      .owaspAgenticTop10.accreditationEvidence,
    false
  );
  assert.ok(
    projection.productEvidence.length > 0
  );
  assert.ok(
    projection.organisationalEvidence.length > 0
  );
  assert.ok(
    projection.organisationalEvidence.every(
      (item) =>
        item.status ===
        'documentary_evidence_required'
    )
  );
});

test('current assessment observations never imply UKAS accreditation', () => {
  const projection =
    buildAccreditationReadinessProjection({
      workflowState: {
        authoritativeArtifacts: {
          frozenTarget: {
            revision: 'abc123'
          },
          bindings: {
            assessmentContextVerified: true
          },
          controlIntelligence: {
            available: true
          }
        },
        humanReviewRequired: true
      }
    });

  assert.ok(
    projection.summary.productEvidenceObserved >= 5
  );
  assert.equal(
    projection.summary.organisationalEvidenceComplete,
    0
  );
  assert.match(
    projection.limitations.join(' '),
    /Only UKAS can grant UKAS accreditation/
  );
});
