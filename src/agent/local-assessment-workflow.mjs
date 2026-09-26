import os from 'node:os';
import path from 'node:path';
import { inspectFrozenRepository } from './tools/inspect-frozen-repository.mjs';
import { buildFrozenInspectionTransport } from './frozen-inspection-transport.mjs';
import { recordHostedDeclaredAssessmentContext } from './hosted-assessment-context.mjs';
import { confirmHostedMappedControlApplicability } from './hosted-applicability-confirmation.mjs';
import { localCliDatabasePath } from './local-cli-mode.mjs';
import { createRedTeamAuthorisation, listRedTeamAuthorisations, listRedTeamRunsForAssessment, getRedTeamRun, ROE_CONFIRMATION } from '../redteam.js';
import { runArlAgent } from './arl-operational-orchestrator.mjs';
import { verifyLocalTargetAdapter } from './local-target-adapter-gate.mjs';
import { parseLocalApplicabilityCommand } from './local-applicability-command.mjs';

export async function runLocalAssessment(repositoryPath, request, options) {
  if (!localCliDatabasePath()) throw new Error('Local CLI mode is required.');
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
  if (request.startsWith('Set assessment context ')) {
    await recordHostedDeclaredAssessmentContext({
      operatorContextInternal: options,
      frozenInspection: buildFrozenInspectionTransport(await inspectFrozenRepository(repositoryPath)),
      declaredContext: JSON.parse(request.slice('Set assessment context '.length))
    });
    return runArlAgent(repositoryPath, 'Where are we?', options);
  }
  const applicability = parseLocalApplicabilityCommand(request);
  if (applicability) {
    const current = await runArlAgent(repositoryPath, 'Where are we?', options);
    const result = await confirmHostedMappedControlApplicability({
      ...options,
      workflowState: current.canonicalData.workflowState,
      controlId: applicability.controlId,
      decision: applicability.decision,
      reason: applicability.reason,
      architectureFactIds: applicability.architectureFactIds
    });
    if (!result.available) throw new Error(result.reason);
    return runArlAgent(repositoryPath, 'Where are we?', options);
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
  const controls = state?.authoritativeArtifacts?.controlIntelligence?.relevantControls || [];
  if (controls.some(control => control.currentStage === 'applicability')) {
    const pending = controls
      .filter(control => control.currentStage === 'applicability')
      .map(control => control.controlId)
      .join(', ');
    result.answer += '\n\nLocal human review required. Controls awaiting an explicit applicability decision: ' + pending +
      '.\nFor Applicable, use: Control ARL-KB-### applies' +
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
