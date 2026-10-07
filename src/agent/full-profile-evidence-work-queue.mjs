import crypto from 'node:crypto';

import {
  deriveControlExecutionPolicy
} from './control-execution-policy.mjs';

import {
  buildCanonicalEvidenceRequirementPlan
} from './canonical-evidence-requirement-plan.mjs';

export const FULL_PROFILE_EVIDENCE_QUEUE_SCHEMA =
  'arl.agent.full-profile-evidence-work-queue.v1';

const CLASSIFICATIONS = Object.freeze({
  MACHINE_OBSERVABLE: 'machine_observable',
  EXISTING_AUTHORITATIVE: 'existing_authoritative_evidence',
  HUMAN_ONLY: 'human_only',
  UNAVAILABLE: 'unavailable_or_inconclusive'
});

function canonicalCheck(entry) {
  const check =
    Array.isArray(entry?.checks) && entry.checks.length
      ? entry.checks[0]
      : entry?.check || null;

  return {
    objective:
      check?.objective || null,
    method:
      check?.method || null,
    requiredEvidence:
      Array.isArray(check?.requiredEvidence)
        ? check.requiredEvidence
        : Array.isArray(check?.required_evidence)
          ? check.required_evidence
          : [],
    passCondition:
      check?.passCondition ||
      check?.pass_condition ||
      null,
    failCondition:
      check?.failCondition ||
      check?.fail_condition ||
      null
  };
}


function normalizeRequirement(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');
}

function stableHumanBatchId(requirements) {
  const digest =
    crypto
      .createHash('sha256')
      .update(JSON.stringify(requirements))
      .digest('hex')
      .slice(0, 12);

  return `human_evidence_batch_${digest}`;
}

function buildHumanReviewBatches(items) {
  const grouped = new Map();

  for (const item of items) {
    if (item.classification !== CLASSIFICATIONS.HUMAN_ONLY) {
      continue;
    }

    const requirements =
      (item.requiredEvidence || [])
        .map(normalizeRequirement)
        .filter(Boolean);

    const signature =
      JSON.stringify(requirements);

    if (!grouped.has(signature)) {
      grouped.set(signature, {
        requirements,
        controls: []
      });
    }

    grouped.get(signature).controls.push({
      controlId: item.controlId,
      title: item.title,
      category: item.category,
      passCondition: item.passCondition,
      failCondition: item.failCondition,
      limitations: item.limitations
    });
  }

  return [...grouped.values()]
    .sort((left, right) =>
      String(left.controls[0]?.controlId || '')
        .localeCompare(
          String(right.controls[0]?.controlId || '')
        )
    )
    .map((group) => ({
      batchId:
        stableHumanBatchId(group.requirements),
      requirements: group.requirements,
      controlIds:
        group.controls.map((item) => item.controlId),
      controls: group.controls,
      reviewInstruction:
        group.requirements.length
          ? 'Provide one authoritative, privacy-safe response that addresses every listed requirement. ARL will bind it only to the controls listed in this batch and will not infer pass/fail from the response alone.'
          : 'Provide the missing accountable human evidence for the listed controls. ARL will not infer pass/fail from the response alone.'
    }));
}

function classifyControl(control) {
  if (control?.currentStage === 'evidence') {
    return {
      classification: CLASSIFICATIONS.EXISTING_AUTHORITATIVE,
      reason:
        'Qualifying evidence already exists in authoritative Control Intelligence and is waiting to be recorded/promoted.'
    };
  }

  if (control?.currentStage !== 'test') {
    return {
      classification: CLASSIFICATIONS.UNAVAILABLE,
      reason:
        'This control is outside evidence collection because another lifecycle stage is currently authoritative.'
    };
  }

  if (control?.chainStatus === 'test_inconclusive') {
    return {
      classification: CLASSIFICATIONS.UNAVAILABLE,
      reason:
        'The current authoritative test is inconclusive and needs additional evidence before a pass/fail result can be established.'
    };
  }

  const policy =
    deriveControlExecutionPolicy({
      currentStage: control.currentStage,
      caseId: control.caseId || null,
      testMode: control.testMode,
      automationStatus: control.automationStatus
    });

  if (policy.mode === 'automatic_test') {
    return {
      classification: CLASSIFICATIONS.MACHINE_OBSERVABLE,
      reason:
        'A verified automatic executor is available and may gather or derive this evidence without human judgement.'
    };
  }

  if (policy.mode === 'manual_evidence') {
    return {
      classification: CLASSIFICATIONS.HUMAN_ONLY,
      reason:
        'No verified automatic executor is available; only genuinely missing human evidence should be requested.'
    };
  }

  return {
    classification: CLASSIFICATIONS.UNAVAILABLE,
    reason:
      'This control requires an explicitly authorised active/bounded test or another non-automatic step.'
  };
}

export function buildFullProfileEvidenceWorkQueue({
  controlIntelligence = null,
  riskKnowledge = null,
  readiness = null
} = {}) {
  const profileControls =
    Number(readiness?.summary?.profileControls || 0);

  if (profileControls !== 108) {
    return {
      schema: FULL_PROFILE_EVIDENCE_QUEUE_SCHEMA,
      available: false,
      reason: 'full_profile_not_active',
      profileControls,
      items: [],
      summary: null
    };
  }

  const knowledgeById =
    new Map(
      (riskKnowledge?.items || []).map((entry) => [
        entry.id,
        entry
      ])
    );

  const items =
    (controlIntelligence?.items || [])
      .filter((control) =>
        ['test', 'evidence'].includes(control?.currentStage)
      )
      .map((control) => {
        const knowledge =
          knowledgeById.get(control.controlId) || null;

        const check =
          canonicalCheck(knowledge);

        let classification =
          classifyControl(control);

        const canonicalCheckAvailable =
          Boolean(check.objective) &&
          Boolean(check.method) &&
          check.requiredEvidence.length > 0 &&
          Boolean(check.passCondition) &&
          Boolean(check.failCondition);

        if (
          classification.classification ===
            CLASSIFICATIONS.HUMAN_ONLY &&
          !canonicalCheckAvailable
        ) {
          classification = {
            classification:
              CLASSIFICATIONS.UNAVAILABLE,
            reason:
              'Canonical Risk Knowledge test/evidence requirements are unavailable. ARL fails closed instead of asking for an unbounded or empty human review.'
          };
        }

        return {
          controlId: control.controlId,
          title: knowledge?.title || null,
          category: knowledge?.category || null,
          currentStage: control.currentStage || null,
          chainStatus: control.chainStatus || null,
          testMode: control.testMode || null,
          automationStatus:
            control.automationStatus || null,
          classification:
            classification.classification,
          classificationReason:
            classification.reason,
          objective: check.objective,
          method: check.method,
          requiredEvidence:
            check.requiredEvidence,
          passCondition:
            check.passCondition,
          failCondition:
            check.failCondition,
          limitations:
            knowledge?.claimsBoundary ||
            knowledge?.claims_boundary ||
            null
        };
      })
      .sort((left, right) =>
        String(left.controlId)
          .localeCompare(String(right.controlId))
      );

  const counts = {
    machineObservable: 0,
    existingAuthoritativeEvidence: 0,
    humanOnly: 0,
    unavailableOrInconclusive: 0
  };

  for (const item of items) {
    if (
      item.classification ===
      CLASSIFICATIONS.MACHINE_OBSERVABLE
    ) {
      counts.machineObservable += 1;
    } else if (
      item.classification ===
      CLASSIFICATIONS.EXISTING_AUTHORITATIVE
    ) {
      counts.existingAuthoritativeEvidence += 1;
    } else if (
      item.classification ===
      CLASSIFICATIONS.HUMAN_ONLY
    ) {
      counts.humanOnly += 1;
    } else {
      counts.unavailableOrInconclusive += 1;
    }
  }

  const humanReviewBatches =
    buildHumanReviewBatches(items);

  return {
    schema: FULL_PROFILE_EVIDENCE_QUEUE_SCHEMA,
    available: true,
    profileControls,
    applicableControls:
      Number(readiness?.summary?.applicableControls || 0),
    controlsMissingEvidence:
      Number(readiness?.summary?.controlsMissingEvidence || 0),
    items,
    humanReviewBatches,
    summary: {
      total: items.length,
      ...counts,
      humanReviewBatches: humanReviewBatches.length
    }
  };
}

export {
  CLASSIFICATIONS as FULL_PROFILE_EVIDENCE_CLASSIFICATIONS
};
