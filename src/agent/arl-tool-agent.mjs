import { inspectRepository } from './tools/inspect-repository.mjs';
import { inspectFrozenRepository } from './tools/inspect-frozen-repository.mjs';
import { getInspectionEvidence } from './tools/get-inspection-evidence.mjs';
import { getDeploymentReadiness } from './tools/get-deployment-readiness.mjs';
import { getAssessmentContext } from './tools/get-assessment-context.mjs';
import { evaluateTargetContextBinding } from './tools/evaluate-target-context-binding.mjs';
import { getAssessmentWorkflowGate } from './tools/get-assessment-workflow-gate.mjs';
import { getAuthoritativeAssessment } from './tools/get-authoritative-assessment.mjs';
import { evaluateAssessmentContextBinding } from './tools/evaluate-assessment-context-binding.mjs';
import { buildAuthoritativeEvidencePlan } from './tools/build-authoritative-evidence-plan.mjs';

function isFalsePositive(finding) {
  return finding?.review?.status === 'false-positive';
}

function buildActiveObservations(inspection) {
  return (inspection.findings || [])
    .filter((finding) => !isFalsePositive(finding))
    .map((finding, index) => ({
      observationId: `OBS-${index + 1}`,
      ruleId: finding.ruleId,
      title: finding.title,
      severity: finding.severity,
      confidence: finding.confidence ?? null,
      category: finding.category ?? null
    }));
}

function buildCanonicalEvidence(inspection, ruleId) {
  const result = getInspectionEvidence(inspection, ruleId);

  if (!result.found) {
    return {
      type: 'evidence',
      found: false,
      ruleId,
      observations: []
    };
  }

  const activeMatches = result.findings.filter(
    (finding) => finding.review?.status !== 'false-positive'
  );

  return {
    type: 'evidence',
    found: activeMatches.length > 0,
    ruleId,
    observations: activeMatches.map((finding, index) => ({
      observationId: `${ruleId}-OBS-${index + 1}`,
      ruleId: finding.ruleId,
      title: finding.title,
      severity: finding.severity,
      confidence: finding.confidence ?? null,
      category: finding.category ?? null,
      summary: finding.summary ?? null,
      remediation: finding.remediation ?? null,
      frameworks: Array.isArray(finding.frameworks)
        ? finding.frameworks
        : [],
      evidence: Array.isArray(finding.evidence)
        ? finding.evidence.map((item) => ({
            source: item.source ?? null,
            basename: item.basename ?? null,
            relativePath: item.relativePath ?? null,
            pathHash: item.pathHash ?? null,
            line: item.line ?? null,
            fact: item.fact ?? null
          }))
        : []
    }))
  };
}

function findHighestSeverityObservation(inspection) {
  const rank = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
    info: 0,
    informational: 0
  };

  const active = buildActiveObservations(inspection);

  if (active.length === 0) {
    return null;
  }

  return active.reduce((best, current) => {
    const bestRank = rank[best.severity] ?? -1;
    const currentRank = rank[current.severity] ?? -1;

    return currentRank > bestRank ? current : best;
  });
}

function detectIntent(userRequest) {
  const text = userRequest.toLowerCase();
  const ruleMatch = userRequest.match(/\bARL-[A-Z]+-\d+\b/i);

  if (
    text.includes('deployment') ||
    text.includes('deploy') ||
    text.includes('release gate') ||
    text.includes('readiness') ||
    text.includes('proceed') ||
    text.includes('hold')
  ) {
    return {
      type: 'deployment_readiness'
    };
  }

  if (
    text.includes('assess this agent') ||
    text.includes('assess this repository') ||
    text.includes('start assessment')
  ) {
    return {
      type: 'assessment'
    };
  }

  if (
    ruleMatch &&
    (
      text.includes('evidence') ||
      text.includes('explain') ||
      text.includes('retrieve')
    )
  ) {
    return {
      type: 'rule_evidence',
      ruleId: ruleMatch[0].toUpperCase()
    };
  }

  if (
    text.includes('highest severity') ||
    text.includes('most severe') ||
    text.includes('highest risk')
  ) {
    return {
      type: 'highest_severity'
    };
  }

  return {
    type: 'inspection_summary'
  };
}

function renderHighestSeverity(canonicalData) {
  const observation = canonicalData.observation;

  if (!observation) {
    return 'No active Inspector observations were found.';
  }

  const lines = [
    `${observation.ruleId} — ${String(observation.severity).toUpperCase()}`,
    observation.title
  ];

  if (observation.confidence) {
    lines.push(
      `Confidence: ${String(observation.confidence).toUpperCase()}`
    );
  }

  if (observation.category) {
    lines.push(`Category: ${observation.category}`);
  }

  return lines.join('\n');
}

function renderEvidence(canonicalData) {
  if (
    !canonicalData.found ||
    canonicalData.observations.length === 0
  ) {
    return `No active evidence observations were found for ${canonicalData.ruleId}.`;
  }

  const sections = canonicalData.observations.map((observation) => {
    const lines = [
      `${observation.observationId}`,
      `${observation.ruleId} — ${String(observation.severity).toUpperCase()}`,
      observation.title
    ];

    if (observation.confidence) {
      lines.push(
        `Confidence: ${String(observation.confidence).toUpperCase()}`
      );
    }

    if (observation.category) {
      lines.push(`Category: ${observation.category}`);
    }

    if (observation.summary) {
      lines.push(`Summary: ${observation.summary}`);
    }

    if (observation.evidence.length > 0) {
      lines.push('Evidence:');

      for (const item of observation.evidence) {
        const location = [
          item.relativePath || item.basename,
          item.line != null ? `line ${item.line}` : null
        ]
          .filter(Boolean)
          .join(', ');

        if (location && item.fact) {
          lines.push(`- ${location}: ${item.fact}`);
        } else if (item.fact) {
          lines.push(`- ${item.fact}`);
        } else if (location) {
          lines.push(`- ${location}`);
        }
      }
    }

    if (observation.remediation) {
      lines.push(`Remediation: ${observation.remediation}`);
    }

    return lines.join('\n');
  });

  return sections.join('\n\n');
}

function renderInspectionSummary(canonicalData) {
  const observations = canonicalData.activeObservations || [];
  const lines = [];

  if (canonicalData.target && canonicalData.binding) {
    lines.push('Assessment target');

    if (canonicalData.target.repositoryPath) {
      lines.push(
        `Repository: ${canonicalData.target.repositoryPath}`
      );
    }

    if (canonicalData.target.revision) {
      lines.push(
        `Revision: ${canonicalData.target.revision}`
      );
    }

    lines.push(
      `Inspector revision binding: ${
        canonicalData.binding.verified ? 'VERIFIED' : 'UNVERIFIED'
      }`
    );

    if (canonicalData.targetContextBinding) {
      lines.push(
        `ARL context binding: ${String(
          canonicalData.targetContextBinding.status || 'unknown'
        ).toUpperCase()}`
      );
    }

    if (canonicalData.assessmentWorkflow) {
      lines.push(
        `Assessment workflow: ${
          canonicalData.assessmentWorkflow.canContinue
            ? 'READY FOR EVIDENCE PLAN'
            : 'BLOCKED'
        }`
      );
    }

    lines.push('');
    lines.push('Inspector completed.');
    lines.push(
      `Active observations: ${observations.length}`
    );

    if (observations.length > 0) {
      lines.push('');
    }
  }

  if (observations.length === 0) {
    if (lines.length > 0) {
      lines.push('No active Inspector observations were found.');
      return lines.join('\n');
    }

    return 'No active Inspector observations were found.';
  }

  lines.push(
    ...observations.map((observation) => {
      const parts = [
        observation.ruleId,
        String(observation.severity).toUpperCase(),
        observation.title
      ];

      return parts.join(' — ');
    })
  );

  return lines.join('\n');
}

function renderDeploymentReadiness(canonicalData) {
  if (canonicalData.type !== 'deployment_readiness') {
    throw new Error(
      `Deployment renderer received invalid canonical type: ${canonicalData.type}`
    );
  }

  if (canonicalData.available === false) {
    const lines = [
      'ARL cannot derive deployment readiness from the available authoritative context.'
    ];

    if (canonicalData.reason) {
      lines.push(`Reason: ${canonicalData.reason}`);
    }

    if (canonicalData.message) {
      lines.push(`Message: ${canonicalData.message}`);
    }

    return lines.join('\n');
  }

  const decisionMap = {
    hold: 'HOLD',
    do_not_deploy: 'DO NOT DEPLOY',
    proceed: 'PROCEED'
  };

  const renderedDecision =
    decisionMap[canonicalData.decision] ??
    String(canonicalData.decision).toUpperCase();

  const lines = [
    `Current ARL deployment readiness: ${renderedDecision}`
  ];

  if (canonicalData.rationale) {
    lines.push('');
    lines.push('Rationale:');
    lines.push(canonicalData.rationale);
  }

  if (canonicalData.summary) {
    lines.push('');
    lines.push('Summary:');

    const summaryFields = [
      ['applicableControls', 'Applicable controls'],
      ['controlsNeedingAssessment', 'Controls needing assessment'],
      ['controlsWithObservedEvidence', 'Controls with observed evidence'],
      ['controlsMissingEvidence', 'Controls missing evidence'],
      ['openFindings', 'Open findings'],
      ['criticalBlockers', 'Critical blockers'],
      ['failedTests', 'Failed tests'],
      ['completedRetests', 'Completed retests'],
      [
        'verifiedClosedRemediationControls',
        'Verified closed remediation controls'
      ],
      ['requiredApprovals', 'Required approvals'],
      ['missingRequiredApprovals', 'Missing required approvals'],
      ['unboundHistoricalFindings', 'Unbound historical findings']
    ];

    for (const [key, label] of summaryFields) {
      if (canonicalData.summary[key] != null) {
        lines.push(`- ${label}: ${canonicalData.summary[key]}`);
      }
    }
  }

  if (
    Array.isArray(canonicalData.reasons) &&
    canonicalData.reasons.length > 0
  ) {
    lines.push('');
    lines.push('Reasons:');

    for (const reason of canonicalData.reasons) {
      lines.push(`- ${reason}`);
    }
  }

  if (
    Array.isArray(canonicalData.requiredApprovals) &&
    canonicalData.requiredApprovals.length > 0
  ) {
    lines.push('');
    lines.push('Required approvals:');

    for (const approval of canonicalData.requiredApprovals) {
      lines.push(`- ${JSON.stringify(approval)}`);
    }
  }

  lines.push('');
  lines.push(
    `Human review required: ${
      canonicalData.humanReviewRequired ? 'YES' : 'NO'
    }`
  );

  return lines.join('\n');
}

async function renderCanonicalResult(canonicalData) {
  switch (canonicalData.type) {
    case 'highest_severity':
      return renderHighestSeverity(canonicalData);

    case 'evidence':
      return renderEvidence(canonicalData);

    case 'inspection_summary':
      return renderInspectionSummary(canonicalData);

    case 'deployment_readiness':
      return renderDeploymentReadiness(canonicalData);

    default:
      throw new Error(
        `Unsupported canonical result type: ${canonicalData.type}`
      );
  }
}

export async function runToolAgent(
  repositoryPath,
  userRequest,
  {
    projectId = null,
    userId = null,
    assessmentId = null
  } = {}
) {
  if (!repositoryPath) {
    throw new Error('repositoryPath is required');
  }

  if (!userRequest) {
    throw new Error('userRequest is required');
  }

  const intent = detectIntent(userRequest);

  let canonicalData;

  /*
   * Deployment readiness is deliberately separated from Inspector.
   *
   * Repository observations never derive deployment readiness.
   * Only authoritative persisted ARL project state may produce it.
   */
  if (intent.type === 'deployment_readiness') {
    canonicalData = await getDeploymentReadiness({
      projectId,
      userId
    });
  } else if (intent.type === 'assessment') {
    /*
     * Assessment orchestration requires a target-bound Inspector result.
     *
     * The repository must be a clean Git worktree and remain on the same
     * revision for the complete inspection.
     */
    const frozen = await inspectFrozenRepository(
      repositoryPath
    );

    const assessmentContext =
      await getAssessmentContext({
        projectId,
        userId
      });

    const authoritativeAssessment =
      await getAuthoritativeAssessment({
        assessmentId,
        userId
      });

    const targetContextBinding =
      evaluateTargetContextBinding({
        target: frozen.target,
        assessmentContext
      });

    const assessmentContextBinding =
      evaluateAssessmentContextBinding({
        authoritativeAssessment,
        assessmentContext
      });

    const assessmentWorkflow =
      getAssessmentWorkflowGate({
        targetContextBinding,
        assessmentContextBinding
      });

    const evidencePlan =
      buildAuthoritativeEvidencePlan({
        assessment:
          authoritativeAssessment.available
            ? authoritativeAssessment
            : null,
        inspection: frozen.inspection,
        assessmentWorkflow
      });

    canonicalData = {
      type: 'inspection_summary',

      target: frozen.target,
      binding: frozen.binding,

      assessmentContext,
      authoritativeAssessment,

      targetContextBinding,
      assessmentContextBinding,

      assessmentWorkflow,
      evidencePlan,

      activeObservations:
        buildActiveObservations(frozen.inspection)
    };
  } else {
    /*
     * Existing repository capabilities remain unchanged.
     *
     * These are Inspector queries, not full assessment orchestration.
     */
    const inspection = await inspectRepository(repositoryPath);

    if (intent.type === 'rule_evidence') {
      canonicalData = buildCanonicalEvidence(
        inspection,
        intent.ruleId
      );
    } else if (intent.type === 'highest_severity') {
      canonicalData = {
        type: 'highest_severity',
        observation: findHighestSeverityObservation(inspection)
      };
    } else {
      canonicalData = {
        type: 'inspection_summary',
        activeObservations: buildActiveObservations(inspection)
      };
    }
  }

  /*
   * Every security-relevant canonical type now has a deterministic
   * presentation boundary.
   *
   * No free-form LLM generates security facts or deployment readiness.
   */
  const answer = await renderCanonicalResult(canonicalData);

  return {
    intent,
    canonicalData,
    answer
  };
}
