import os from 'node:os';
import path from 'node:path';
import { inspectFrozenRepository } from './tools/inspect-frozen-repository.mjs';
import { buildFrozenInspectionTransport } from './frozen-inspection-transport.mjs';
import { recordDeclaredAssessmentContext } from './assessment-context-authority.mjs';
import { confirmMappedControlApplicability } from './applicability-confirmation.mjs';
import { recordRemediationApplicabilityConfirmation } from './remediation-applicability-handoff.mjs';
import { isLocalCliModeEnabled } from './local-cli-mode.mjs';
import { createRedTeamAuthorisation, listRedTeamAuthorisations, listRedTeamRunsForAssessment, getRedTeamRun, ROE_CONFIRMATION } from '../redteam.js';
import { runArlAgent } from './arl-operational-orchestrator.mjs';
import { completePersistedExactRetest } from './authoritative-auto-actions.mjs';
import { verifyLocalTargetAdapter } from './local-target-adapter-gate.mjs';
import { parseLocalApplicabilityCommand, localApplicabilityCandidateIds, focusLocalApplicabilityControl } from './local-applicability-command.mjs';
import { parseLocalManualEvidenceCommand } from './local-manual-evidence-command.mjs';
import { verifyExplicitHumanEvidence } from './verify-explicit-human-evidence.mjs';
import { showLocalAssessmentContext } from './local-assessment-context-view.mjs';
import { deriveLocalOwnerApplicability } from './local-owner-applicability-policy.mjs';
import {
  assessControlApplicability,
  assessControlApplicabilityFromLocalOwnerAttestation,
  closeControlFinding,
  getControlIntelligenceControl,
  recordControlEvidence,
  recordControlTestExecution,
  recordDeploymentDecision
} from '../control-intelligence.js';

import { db, id, nowIso } from '../db.js';
import { intelligenceDigest } from '../control-intelligence-core.js';

function normalizeEvidenceRequirement(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');
}

function validateCanonicalManualEvidenceChecklist({
  manualEvidence,
  workflowState,
  controlId
}) {
  if (manualEvidence.result === 'inconclusive') {
    return {
      observedResult: manualEvidence.observedResult,
      canonicalChecklistVerified: false
    };
  }

  const queueItem =
    (workflowState?.evidenceWorkQueue?.items || [])
      .find((item) => item.controlId === controlId) || null;

  const expected =
    (queueItem?.requiredEvidence || [])
      .map(normalizeEvidenceRequirement)
      .filter(Boolean);

  if (!expected.length) {
    throw new Error(
      'Conclusive manual evidence is blocked because canonical required evidence is unavailable for this control.'
    );
  }

  const supplied =
    (manualEvidence.evidenceChecklist || [])
      .map((item) => ({
        ...item,
        normalizedRequirement:
          normalizeEvidenceRequirement(item.requirement)
      }));

  const suppliedRequirements =
    supplied.map((item) => item.normalizedRequirement);

  if (
    new Set(suppliedRequirements).size !==
    suppliedRequirements.length
  ) {
    throw new Error(
      'Manual evidence checklist contains duplicate canonical requirements.'
    );
  }

  const expectedSet = new Set(expected);
  const suppliedSet = new Set(suppliedRequirements);

  const missing =
    expected.filter((requirement) =>
      !suppliedSet.has(requirement)
    );

  const unexpected =
    suppliedRequirements.filter((requirement) =>
      !expectedSet.has(requirement)
    );

  if (
    missing.length ||
    unexpected.length ||
    supplied.length !== expected.length
  ) {
    throw new Error(
      'Conclusive manual evidence must address the exact canonical required-evidence checklist for this control.'
    );
  }

  const checklistProjection =
    expected.map((requirement) => {
      const item =
        supplied.find(
          (candidate) =>
            candidate.normalizedRequirement === requirement
        );

      return {
        requirement,
        evidenceReference: item.evidenceReference,
        observation: item.observation
      };
    });

  const observedResult = [
    manualEvidence.observedResult,
    '',
    'Canonical required-evidence checklist:',
    ...checklistProjection.map(
      (item, index) =>
        `${index + 1}. ${item.requirement} | ${item.evidenceReference} | ${item.observation}`
    )
  ].join('\n');

  if (observedResult.length > 6000) {
    throw new Error(
      'Manual evidence checklist is too large for the bounded authoritative observation record.'
    );
  }

  return {
    observedResult,
    canonicalChecklistVerified: true
  };
}

export async function runLocalAssessment(repositoryPath, request, options) {
  if (!isLocalCliModeEnabled()) throw new Error('Local CLI mode is required.');
  if (/(?:bounded test|retest)/i.test(request)) {
    const authorisations = await listRedTeamAuthorisations(options);
    const unsafe = authorisations.some(item => {
      if (item.status !== 'active' || Date.parse(item.windowEnd) <= Date.now()) return false;
      try {
        const url = new URL(item.endpointOrigin);
        return item.environment !== 'local' || url.protocol !== 'http:' ||
          !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
      } catch { return true; }
    });
    if (unsafe) throw new Error('Local mode refuses non-local adapter authorizations.');
  }
  if (/^continue(?: assessment)?[.!?]*$/i.test(request.trim())) {
    let current =
      await runArlAgent(
        repositoryPath,
        'Where are we?',
        options
      );

    for (let step = 0; step < 108; step += 1) {
      const state =
        current?.canonicalData?.workflowState || null;

      const fullProfile =
        Number(state?.readiness?.summary?.profileControls || 0) === 108;

      if (
        !fullProfile ||
        state?.stage !== 'control_applicability_required' ||
        state?.nextAllowedAction?.name !== 'resolve_control_applicability' ||
        state?.nextAllowedAction?.actor !== 'user' ||
        state?.nextAllowedAction?.requiresUserInput !== true ||
        !state?.scopedControl?.controlId
      ) {
        break;
      }

      const controlId =
        state.scopedControl.controlId;

      const detail =
        await getControlIntelligenceControl({
          projectId: options.projectId,
          controlId,
          userId: options.userId
        });

      const snapshotId =
        state?.authoritativeArtifacts
          ?.assessmentContext
          ?.systemSnapshotId || null;

      if (
        !snapshotId ||
        detail?.systemSnapshot?.id !== snapshotId
      ) {
        throw new Error(
          'Owner-authorised applicability resolution requires the exact current authoritative snapshot.'
        );
      }

      const ownerDecision =
        deriveLocalOwnerApplicability(detail);

      if (ownerDecision) {
        await assessControlApplicability({
          projectId: options.projectId,
          controlId,
          userId: options.userId,
          input: {
            snapshotId,
            decision: ownerDecision.decision,
            reason: ownerDecision.reason,
            architectureFactIds:
              ownerDecision.architectureFactIds
          }
        });
      } else {
        await assessControlApplicabilityFromLocalOwnerAttestation({
          projectId: options.projectId,
          controlId,
          userId: options.userId,
          input: {
            snapshotId,
            decision: 'applicable',
            reason:
              'Owner-authorised full-profile policy: unresolved conditional applicability is conservatively included for assessment instead of blocking the workflow or excluding the control. This inclusion does not prove the control passes and does not approve deployment.',
            architectureFactIds: []
          }
        });
      }

      current =
        await runArlAgent(
          repositoryPath,
          'Where are we?',
          options
        );
    }

    return runArlAgent(
      repositoryPath,
      'Continue assessment',
      options
    );
  }

  if (/^show assessment context[.!?]*$/i.test(request.trim())) {
    return showLocalAssessmentContext({
      projectId: options.projectId,
      userId: options.userId
    });
  }
  if (/^show evidence[.!?]*$/i.test(request.trim())) {
    const runs = await listRedTeamRunsForAssessment(options);
    const evidence = await Promise.all(runs.map(run => getRedTeamRun({ runId: run.id, userId: options.userId })));
    return {
      canonicalData: { type: 'local_evidence_review', evidence, securityStateChanged: false,
        deploymentDecisionWritten: false, humanReviewRequired: true },
      answer: evidence.length
        ? 'Persisted bounded-test evidence (redacted):\n' + JSON.stringify(evidence.map(run => ({
          digest: run.digest, signatureValid: run.signatureValid, summary: run.summary, results: run.results
        })), null, 2) + '\n\nAfter human review, use: I have reviewed the evidence. Human final deployment decision remains required.'
        : 'No bounded-test evidence is persisted yet. Human final deployment decision remains required.'
    };
  }
  if (/^I have reviewed and verify the exact retest evidence[.!?]*$/i.test(request.trim())) {
    const current =
      await runArlAgent(
        repositoryPath,
        'Where are we?',
        options
      );

    const state =
      current?.canonicalData?.workflowState || null;
    const action =
      state?.nextAllowedAction || {};

    const standardEvidenceGate =
      state?.stage === 'retest_evidence_verification_required' &&
      action.name === 'provide_verified_retest_evidence' &&
      action.actor === 'user' &&
      action.requiresUserInput === true &&
      Boolean(action.controlId);

    const manualRetestRecoveryGate =
      action.caseId == null &&
      Boolean(action.controlId) &&
      state?.scopedControl?.currentStage === 'retest' &&
      state?.remediationSnapshotGate?.active === true;

    if (!standardEvidenceGate && !manualRetestRecoveryGate) {
      throw new Error(
        'Exact retest evidence review is only accepted for the authoritative exact-retest evidence lineage.'
      );
    }

    /*
     * Bounded Red Team exact retests have a caseId and keep using the
     * authoritative Red Team completion path.
     *
     * Manual controls intentionally have caseId=null. Their passed retest
     * already exists in Control Intelligence and must be human-verified
     * without inventing a Red Team case.
     */
    if (action.caseId) {
      const completion =
        await completePersistedExactRetest({
          action,
          repositoryPath,
          projectId: options.projectId,
          userId: options.userId,
          assessmentId: options.assessmentId
        });

      if (completion?.executed !== true) {
        throw new Error(
          completion?.reason ||
          'Authoritative exact retest evidence completion failed.'
        );
      }
    } else {
      const detail =
        await getControlIntelligenceControl({
          projectId: options.projectId,
          controlId: action.controlId,
          userId: options.userId
        });

      const systemSnapshotId =
        state?.authoritativeArtifacts
          ?.assessmentContext?.systemSnapshotId ||
        null;

      if (
        !systemSnapshotId ||
        detail?.systemSnapshot?.id !== systemSnapshotId
      ) {
        throw new Error(
          'Manual exact retest evidence is not bound to the current authoritative snapshot.'
        );
      }

      const tests = [
        ...(Array.isArray(detail.tests) ? detail.tests : []),
        ...(Array.isArray(detail.testHistory)
          ? detail.testHistory
          : [])
      ];

      const uniqueTests = [
        ...new Map(
          tests
            .filter((item) => item?.id)
            .map((item) => [item.id, item])
        ).values()
      ];

      const retests = uniqueTests.filter(
        (item) =>
          item.executionKind === 'retest' &&
          item.result === 'passed' &&
          item.systemSnapshotId === systemSnapshotId &&
          item.findingId &&
          item.remediationId &&
          item.findingId === item.remediationId &&
          item.retestOfExecutionId &&
          item.originalSnapshotId &&
          item.originalSnapshotId !== systemSnapshotId
      );

      if (retests.length !== 1) {
        throw new Error(
          `Manual exact retest verification requires exactly one passed exact retest; found ${retests.length}.`
        );
      }

      const retest = retests[0];

      const finding =
        (detail.findings || []).find(
          (item) =>
            item.id === retest.findingId &&
            !['verified_closed', 'accepted_risk'].includes(
              item.status
            )
        );

      if (!finding) {
        throw new Error(
          'Open finding for the manual exact retest was not found.'
        );
      }

      const existingEvidence =
        (detail.evidence || []).find(
          (item) =>
            item.testExecutionId === retest.id &&
            item.sourceType === 'manual_exact_retest' &&
            item.retentionStatus === 'active'
        );

      if (!existingEvidence) {
        throw new Error(
          'Manual exact retest evidence was not found for the passed retest.'
        );
      }

      /*
       * Record a closure-scoped evidence item carrying the exact finding and
       * remediation lineage. The original observation is retained unchanged.
       */
      const closureEvidence =
        await recordControlEvidence({
          projectId: options.projectId,
          controlId: action.controlId,
          userId: options.userId,
          input: {
            systemSnapshotId,
            evidenceClass: 'human_provided',
            sourceType: 'arl_local_exact_retest_proof',
            sourceReference:
              existingEvidence.sourceReference,
            testExecutionId: retest.id,
            findingId: finding.id,
            remediationId: finding.id,
            limitations:
              existingEvidence.limitations ||
              'Human verification is limited to the exact manual retest and remediated snapshot.'
          }
        });

      const row =
        await db.prepare(`
          SELECT *
          FROM control_evidence_items
          WHERE id=? AND project_id=?
        `).get(
          closureEvidence.id,
          options.projectId
        );

      if (!row || row.verification_state !== 'unverified') {
        throw new Error(
          'Manual exact retest closure evidence is not available for human verification.'
        );
      }

      const previousDescriptor =
        JSON.parse(row.descriptor_json || '{}');

      const timestamp = nowIso();
      const reason =
        'Explicit human review verified the persisted manual exact-retest evidence for the current remediated snapshot.';

      const descriptor = {
        ...previousDescriptor,
        verificationState: 'verified',
        verificationScope:
          'human_reviewed_manual_exact_retest'
      };

      const nextDigest =
        intelligenceDigest(descriptor);

      const trust = {
        schema:
          'arl.control-evidence-trust-revision.v1',
        evidenceId: closureEvidence.id,
        previousVerificationState: 'unverified',
        newVerificationState: 'verified',
        reason,
        controlId: action.controlId,
        actorId: options.userId,
        createdAt: timestamp
      };

      await db.transaction(async () => {
        const updated =
          await db.prepare(`
            UPDATE control_evidence_items
            SET verification_state='verified',
                descriptor_json=?,
                integrity_digest=?
            WHERE id=?
              AND project_id=?
              AND verification_state='unverified'
          `).run(
            JSON.stringify(descriptor),
            nextDigest,
            closureEvidence.id,
            options.projectId
          );

        if (Number(updated.changes || 0) !== 1) {
          throw new Error(
            'Manual exact retest evidence verification conflict.'
          );
        }

        await db.prepare(`
          INSERT INTO control_evidence_trust_revisions
          (
            id,
            workspace_id,
            project_id,
            evidence_id,
            replacement_evidence_id,
            previous_verification_state,
            new_verification_state,
            reason,
            previous_descriptor_json,
            previous_integrity_digest,
            revision_digest,
            actor_id,
            created_at
          )
          VALUES (?,?,?,?,NULL,?,?,?,?,?,?,?,?)
        `).run(
          id('ctr_'),
          row.workspace_id,
          options.projectId,
          closureEvidence.id,
          'unverified',
          'verified',
          reason,
          row.descriptor_json,
          row.integrity_digest,
          intelligenceDigest(trust),
          options.userId,
          timestamp
        );
      });

      await closeControlFinding({
        projectId: options.projectId,
        controlId: action.controlId,
        findingId: finding.id,
        userId: options.userId,
        input: {
          systemSnapshotId,
          expectedUpdatedAt: finding.updatedAt,
          limitations:
            'Verified closed after explicit human review of the exact manual retest evidence for the remediated snapshot. This is not a deployment approval.'
        }
      });
    }

    return runArlAgent(
      repositoryPath,
      'Where are we?',
      options
    );
  }

  if (request.startsWith('Set assessment context ')) {
    await recordDeclaredAssessmentContext({
      operatorContextInternal: options,
      frozenInspection: buildFrozenInspectionTransport(await inspectFrozenRepository(repositoryPath)),
      declaredContext: JSON.parse(request.slice('Set assessment context '.length))
    });
    return runArlAgent(repositoryPath, 'Where are we?', options);
  }
  const applicability = parseLocalApplicabilityCommand(request);
  if (applicability) {
    const current = await runArlAgent(
      repositoryPath,
      'Where are we?',
      options
    );

    const workflowState =
      current?.canonicalData?.workflowState || null;

    const remediationGate =
      workflowState?.remediationSnapshotGate || null;

    const freshRemediationApplicability =
      applicability.decision === 'applicable' &&
      workflowState?.stage ===
        'control_applicability_required' &&
      remediationGate?.active === true &&
      remediationGate?.freshApplicabilityRequired === true &&
      remediationGate?.controlId === applicability.controlId &&
      workflowState?.scopedControl?.controlId ===
        applicability.controlId;

    if (freshRemediationApplicability) {
      const result =
        await recordRemediationApplicabilityConfirmation({
          repositoryPath,
          projectId: options.projectId,
          userId: options.userId,
          assessmentId: options.assessmentId
        });

      if (!result.available) {
        throw new Error(result.reason);
      }

      return runArlAgent(
        repositoryPath,
        'Where are we?',
        options
      );
    }

    let applicabilityWorkflowState = workflowState;

    if (
      workflowState?.stage !== 'control_applicability_required' ||
      workflowState?.scopedControl?.controlId !== applicability.controlId
    ) {
      const detail =
        await getControlIntelligenceControl({
          projectId: options.projectId,
          controlId: applicability.controlId,
          userId: options.userId
        });

      const focused =
        focusLocalApplicabilityControl(
          workflowState,
          detail,
          applicability.controlId
        );

      if (!focused) {
        throw new Error(
          'The selected control is not at the applicability gate on the current authoritative snapshot.'
        );
      }

      applicabilityWorkflowState = focused;
    }

    if (
      applicability.decision === 'not_applicable' &&
      (!applicability.architectureFactIds ||
        applicability.architectureFactIds.length === 0)
    ) {
      const snapshotId =
        applicabilityWorkflowState?.authoritativeArtifacts
          ?.assessmentContext?.systemSnapshotId || null;

      if (!snapshotId) {
        throw new Error(
          'Local owner applicability attestation requires the current authoritative snapshot.'
        );
      }

      await assessControlApplicabilityFromLocalOwnerAttestation({
        projectId: options.projectId,
        controlId: applicability.controlId,
        userId: options.userId,
        input: {
          snapshotId,
          decision: applicability.decision,
          reason: applicability.reason,
          architectureFactIds: []
        }
      });

      return runArlAgent(
        repositoryPath,
        'Where are we?',
        options
      );
    }

    const result =
      await confirmMappedControlApplicability({
        ...options,
        workflowState: applicabilityWorkflowState,
        controlId: applicability.controlId,
        decision: applicability.decision,
        reason: applicability.reason,
        architectureFactIds:
          applicability.architectureFactIds
      });

    if (!result.available) {
      throw new Error(result.reason);
    }

    return runArlAgent(
      repositoryPath,
      'Where are we?',
      options
    );
  }
  const manualEvidence =
    parseLocalManualEvidenceCommand(request);

  if (manualEvidence) {
    const current =
      await runArlAgent(
        repositoryPath,
        'Where are we?',
        options
      );

    const state =
      current?.canonicalData?.workflowState;

    const action =
      state?.nextAllowedAction || {};

    const scopedControlId =
      String(
        action.controlId ||
        state?.scopedControl?.controlId ||
        ''
      ).trim();

    const initialManualEvidenceGate =
      state?.stage === 'manual_evidence_required' &&
      action.name === 'provide_required_manual_evidence';

    const existingManualEvidenceGate =
      state?.stage === 'evidence_recording_required' &&
      action.name === 'record_authoritative_evidence' &&
      action.caseId == null;

    const exactManualRetestGate =
      state?.stage === 'exact_retest_required' &&
      action.name === 'authorise_and_run_exact_retest' &&
      action.caseId == null;

    if (
      (!initialManualEvidenceGate &&
        !existingManualEvidenceGate &&
        !exactManualRetestGate) ||
      action.actor !== 'user' ||
      action.requiresUserInput !== true
    ) {
      throw new Error(
        'Manual evidence can only be recorded at an authoritative manual evidence or manual exact-retest gate.'
      );
    }

    if (
      !scopedControlId ||
      manualEvidence.controlId !== scopedControlId
    ) {
      throw new Error(
        `Manual evidence control mismatch: expected ${scopedControlId || 'none'}, received ${manualEvidence.controlId}.`
      );
    }

    const systemSnapshotId =
      state?.authoritativeArtifacts
        ?.assessmentContext?.systemSnapshotId ||
      '';

    if (!systemSnapshotId) {
      throw new Error(
        'Manual evidence requires the current authoritative system snapshot.'
      );
    }

    const detail =
      await getControlIntelligenceControl({
        projectId: options.projectId,
        controlId: scopedControlId,
        userId: options.userId
      });

    if (
      detail?.systemSnapshot?.id !== systemSnapshotId
    ) {
      throw new Error(
        'Manual evidence is not bound to the current authoritative snapshot.'
      );
    }

    if (existingManualEvidenceGate) {
      const tests = [
        ...(Array.isArray(detail?.tests) ? detail.tests : []),
        ...(Array.isArray(detail?.testHistory) ? detail.testHistory : [])
      ];

      const passed = tests.filter(
        (item) =>
          item?.result === 'passed' &&
          item?.executionKind !== 'retest' &&
          item?.systemSnapshotId === systemSnapshotId
      );

      const evidence = (detail?.evidence || []).filter(
        (item) =>
          item?.testExecutionId === passed[0]?.id &&
          item?.sourceType === 'manual_review' &&
          item?.retentionStatus === 'active' &&
          item?.verificationState === 'unverified'
      );

      if (passed.length !== 1 || evidence.length !== 1) {
        throw new Error(
          'Existing manual evidence recovery requires exactly one passed initial test and one matching active unverified manual-review evidence item.'
        );
      }

      await verifyExplicitHumanEvidence({
        projectId: options.projectId,
        evidenceId: evidence[0].id,
        userId: options.userId,
        controlId: scopedControlId,
        verificationScope:
          'explicit_human_manual_control_review_recovery',
        reason:
          'The accountable operator explicitly resubmitted the same manual control review to complete trust verification for the current authoritative snapshot.'
      });

      return runArlAgent(
        repositoryPath,
        'Where are we?',
        options
      );
    }

    const checklistValidation =
      validateCanonicalManualEvidenceChecklist({
        manualEvidence,
        workflowState: state,
        controlId: scopedControlId
      });

    let executionInput;

    if (initialManualEvidenceGate) {
      if (detail?.chain?.currentStage !== 'test') {
        throw new Error(
          'Manual evidence control is not at the authoritative test stage for the current snapshot.'
        );
      }

      executionInput = {
        systemSnapshotId,
        executionKind: 'initial',
        executionMethod: 'manual_review',
        result: manualEvidence.result,
        observedResult:
          checklistValidation.observedResult,
        inputReference:
          manualEvidence.sourceReference,
        limitations:
          manualEvidence.limitations
      };
    } else {
      if (detail?.chain?.currentStage !== 'retest') {
        throw new Error(
          'Manual exact retest control is not at the authoritative retest stage.'
        );
      }

      const tests = [
        ...(Array.isArray(detail?.tests) ? detail.tests : []),
        ...(Array.isArray(detail?.testHistory) ? detail.testHistory : [])
      ];

      const uniqueTests = [
        ...new Map(
          tests
            .filter((item) => item?.id)
            .map((item) => [item.id, item])
        ).values()
      ];

      const failed = uniqueTests.filter(
        (item) =>
          item.result === 'failed' &&
          item.executionKind !== 'retest'
      );

      const openFindings = (Array.isArray(detail?.findings)
        ? detail.findings
        : []
      ).filter(
        (item) =>
          item?.id &&
          !['verified_closed', 'accepted_risk'].includes(item.status)
      );

      if (failed.length !== 1) {
        throw new Error(
          `Manual exact retest requires exactly one failed baseline; found ${failed.length}.`
        );
      }

      if (openFindings.length !== 1) {
        throw new Error(
          `Manual exact retest requires exactly one open finding; found ${openFindings.length}.`
        );
      }

      const baseline = failed[0];
      const finding = openFindings[0];

      executionInput = {
        systemSnapshotId,
        executionKind: 'retest',
        retestOfExecutionId: baseline.id,
        findingId: finding.id,
        remediationId: finding.id,
        originalSnapshotId: baseline.systemSnapshotId,
        executionMethod: 'manual_exact_retest',
        result: manualEvidence.result,
        expectedResult: baseline.expectedResult,
        observedResult:
          checklistValidation.observedResult,
        inputReference:
          baseline.inputReference ||
          manualEvidence.sourceReference,
        limitations:
          manualEvidence.limitations
      };
    }

    const execution =
      await recordControlTestExecution({
        projectId: options.projectId,
        controlId: scopedControlId,
        userId: options.userId,
        input: executionInput
      });

    const evidence =
      await recordControlEvidence({
        projectId: options.projectId,
        controlId: scopedControlId,
        userId: options.userId,
        input: {
          systemSnapshotId,
          evidenceClass: 'human_provided',
          sourceType:
            exactManualRetestGate
              ? 'manual_exact_retest'
              : 'manual_review',
          sourceReference:
            manualEvidence.sourceReference,
          testExecutionId: execution.id,
          limitations:
            [
              manualEvidence.limitations,
              checklistValidation.canonicalChecklistVerified
                ? 'Canonical required-evidence checklist verified against Risk Knowledge before accepting a conclusive manual result.'
                : 'Manual result remains inconclusive; canonical checklist completion was not asserted.'
            ].filter(Boolean).join(' ')
        }
      });

    /*
     * For the initial manual-control gate, this command itself is the
     * accountable human review. Promote only the exact evidence item created
     * by this explicit invocation. Retest evidence keeps its separate explicit
     * verification step and is intentionally not promoted here.
     */
    if (initialManualEvidenceGate) {
      await verifyExplicitHumanEvidence({
        projectId: options.projectId,
        evidenceId: evidence.id,
        userId: options.userId,
        controlId: scopedControlId,
        verificationScope:
          'explicit_human_manual_control_review',
        reason:
          'The accountable local operator explicitly submitted and validated this manual control evidence for the current authoritative snapshot.'
      });
    }

    return runArlAgent(
      repositoryPath,
      'Where are we?',
      options
    );
  }

  if (/^i authorise the bounded test[.!?]*$/i.test(request.trim())) {
    const prepared = await runArlAgent(repositoryPath, 'Assess this agent', options);
    if (prepared?.canonicalData?.workflowState?.stage !== 'bounded_test_required') {
      return explainLocalGate(prepared, { repositoryPath });
    }

    const origin = `http://127.0.0.1:${process.env.ARL_TARGET_ADAPTER_PORT || '8787'}`;
    const expectedRevision =
      prepared?.canonicalData?.workflowState
        ?.authoritativeArtifacts?.frozenTarget?.revision ||
      process.env.ARL_EXPECTED_TARGET_SHA ||
      '';
    const adapterGate = await verifyLocalTargetAdapter({
      repositoryPath,
      expectedRevision,
      origin
    });

    if (adapterGate.available !== true) {
      return blockedLocalAdapterResult(prepared, adapterGate);
    }

    const now = Date.now();
    const active = (await listRedTeamAuthorisations(options)).filter(item =>
      item.status === 'active' && Date.parse(item.windowStart) <= now && Date.parse(item.windowEnd) > now);
    if (active.length > 1 || active.some(item => item.environment !== 'local' || item.endpointOrigin !== origin)) {
      throw new Error('Local Rules of Engagement are ambiguous or target a different adapter.');
    }
    if (!active.length) await createRedTeamAuthorisation({ ...options, input: {
      environment: 'local', targetName: `Local ${path.basename(path.resolve(repositoryPath || '.'))}`,
      endpointOrigin: origin,
      authorityBasis: 'owner', authorisedBy: os.userInfo().username,
      authorisedRole: 'Local repository operator', emergencyContact: `Local terminal operator ${os.userInfo().username}`,
      windowStart: new Date(now - 1000).toISOString(), windowEnd: new Date(now + 3600000).toISOString(),
      permittedActions: ['Bounded synthetic adversarial evaluation through the verified local adapter'],
      prohibitedActions: ['Production effects', 'External actions'],
      dataClassification: 'synthetic-only', retentionDays: 30,
      syntheticDataOnly: true, dryRunToolsOnly: true, noProductionEffects: true,
      confirmation: ROE_CONFIRMATION
    } });
    return runArlAgent(repositoryPath, 'Run the bounded test', options);
  }
  if (
    /^I reviewed the current ARL readiness and approve the final deployment decision[.!?]*$/i.test(
      request.trim()
    )
  ) {
    const current =
      await runArlAgent(
        repositoryPath,
        'Where are we?',
        options
      );

    const state =
      current?.canonicalData?.workflowState || null;

    const readiness =
      state?.readiness ||
      state?.authoritativeArtifacts?.readiness ||
      null;

    const snapshotId =
      state?.authoritativeArtifacts
        ?.assessmentContext
        ?.systemSnapshotId || null;

    if (
      state?.stage !== 'readiness_review' ||
      readiness?.available !== true ||
      !snapshotId
    ) {
      throw new Error(
        'Final deployment decision can only be recorded at the authoritative readiness-review gate.'
      );
    }

    const existing =
      await db.prepare(`
        SELECT id, decision, status, decision_method,
               decision_maker_id, decided_at, decision_digest
        FROM control_deployment_decisions
        WHERE project_id = ?
          AND system_snapshot_id = ?
          AND status = 'current'
      `).get(
        options.projectId,
        snapshotId
      );

    if (existing) {
      return {
        canonicalData: {
          type: 'final_human_deployment_decision',
          decision: existing,
          deploymentDecisionWritten: true,
          humanReviewRequired: false,
          securityStateChanged: false
        },
        answer: [
          `Final human deployment decision already recorded: ${String(existing.decision || '').toUpperCase()}`,
          `Decision ID: ${existing.id}`,
          `Snapshot: ${snapshotId}`,
          'Assessment complete.'
        ].join('\\n')
      };
    }

    const decision =
      await recordDeploymentDecision({
        projectId: options.projectId,
        userId: options.userId,
        input: {
          systemSnapshotId: snapshotId,
          expectedCurrentDecisionId: '',
          rationale:
            'Accountable human reviewed the current ARL readiness and approved the server-derived deployment decision for this exact assessed snapshot.'
        }
      });

    return {
      canonicalData: {
        type: 'final_human_deployment_decision',
        decision,
        deploymentDecisionWritten: true,
        humanReviewRequired: false,
        securityStateChanged: true
      },
      answer: [
        `Final human deployment decision recorded: ${String(decision.decision || '').toUpperCase()}`,
        `Decision ID: ${decision.id}`,
        `Snapshot: ${decision.systemSnapshotId}`,
        `Decision method: ${decision.decisionMethod}`,
        'Assessment complete.'
      ].join('\\n')
    };
  }

  if (request === 'I have reviewed the evidence') request = 'Continue assessment';
  // Review/Continue is deliberately a separate human invocation. The existing
  // workflow binds evidence and findings; it never writes deployment approval.
  return explainLocalGate(await runArlAgent(repositoryPath, request, options), { repositoryPath });
}

function blockedLocalAdapterResult(result, adapterGate) {
  return {
    ...result,
    canonicalData: {
      ...(result?.canonicalData || {}),
      localAdapterGate: adapterGate,
      securityStateChanged: false,
      deploymentDecisionWritten: false,
      humanReviewRequired: true
    },
    answer: [
      result?.answer || 'The bounded test is waiting for a verified local adapter.',
      '',
      `Local bounded-test adapter: NOT READY (${adapterGate.reason}).`,
      'ARL did not create a Rules of Engagement authorisation and did not run the test.',
      'Start or configure a synthetic dry-run adapter bound to this exact repository revision, then retry authorisation.',
      '',
      'Human final deployment decision remains required. No deployment decision was written.'
    ].join('\n')
  };
}

async function explainLocalGate(result, { repositoryPath } = {}) {
  const state = result?.canonicalData?.workflowState;
  const pending = localApplicabilityCandidateIds(state);
  if (pending.length) {
    result.answer += '\n\nLocal human review required. Authoritative applicability control' +
      (pending.length === 1 ? ': ' : 's: ') + pending.join(', ') +
      '.\nFor Applicable, use: Set control applicability {"controlId":"ARL-KB-###","decision":"applicable","reason":"specific human rationale"}' +
      '\nFor Not applicable or More information required, use: Set control applicability {"controlId":"ARL-KB-###","decision":"not_applicable|context_required","reason":"specific human rationale","architectureFactIds":["confirmed:fact"]}';
  }

  if (state?.stage === 'bounded_test_required' && repositoryPath) {
    const expectedRevision =
      state?.authoritativeArtifacts?.frozenTarget?.revision ||
      process.env.ARL_EXPECTED_TARGET_SHA ||
      '';
    const origin = `http://127.0.0.1:${process.env.ARL_TARGET_ADAPTER_PORT || '8787'}`;
    const adapterGate = await verifyLocalTargetAdapter({
      repositoryPath,
      expectedRevision,
      origin
    });
    result.canonicalData = {
      ...(result.canonicalData || {}),
      localAdapterGate: adapterGate
    };
    if (adapterGate.available !== true) {
      result.answer += `\n\nLocal bounded-test adapter: NOT READY (${adapterGate.reason}). Do not authorise this test until an adapter is bound to the exact target revision.`;
    } else {
      result.answer += '\n\nLocal bounded-test adapter: VERIFIED for this frozen target.';
    }
  }

  result.answer += '\n\nHuman final deployment decision remains required. No deployment decision was written.';
  return result;
}
