export const FIX_PROVE_STATUSES = Object.freeze({
  RESOLVED: 'RESOLVED',
  PARTIALLY_RESOLVED: 'PARTIALLY RESOLVED',
  NOT_RESOLVED: 'NOT RESOLVED',
  NO_LONGER_APPLICABLE: 'NO LONGER APPLICABLE',
  NEW_FINDING: 'NEW FINDING',
});

export const FRESH_RESCAN_LABEL = 'Fresh bounded re-assessment';

export const DEPENDENCY_COUNTING_SEMANTICS =
  'Dependency counts are tool-specific and are not expected to match exactly. Inspector reports its normalized locked-dependency inventory, while external advisory tools may report ecosystem-specific package extraction.';

const FORBIDDEN_ASSURANCE = /\b(?:fully secure|risk[- ]free|certified|production[- ]safe)\b/i;
const THIRD_PARTY_INDEPENDENCE = /\bindependent\s+(?:audit|security assessment|penetration test|re-?scan)\b/i;

function clean(value, max = 500) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function finiteCount(value) {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : null;
}

function findingIdentity(finding) {
  if (finding?.findingId) return clean(finding.findingId, 160);
  const evidence = finding?.evidence || {};
  const component = finding?.component || evidence.component || evidence.package || evidence.advisoryId || '';
  return [clean(finding?.ruleId, 60), clean(component, 160), clean(finding?.title, 180)].join(':');
}

function currentEvidenceSummary(finding) {
  if (!finding) return null;
  return {
    ruleId: clean(finding.ruleId, 60) || null,
    title: clean(finding.title, 180) || null,
    severity: clean(finding.severity, 30) || null,
    evidence: finding.evidence || null,
  };
}

export function dependencyCountPresentation({ inventoryCount, externalCounts = [] } = {}) {
  const normalizedExternal = (Array.isArray(externalCounts) ? externalCounts : [])
    .map((item) => ({
      source: clean(item?.source || item?.ecosystem, 80) || 'external',
      count: finiteCount(item?.count),
    }))
    .filter((item) => item.count !== null);
  const externalTotal = normalizedExternal.length
    ? normalizedExternal.reduce((sum, item) => sum + item.count, 0)
    : null;

  return {
    inventory_count: finiteCount(inventoryCount),
    external_scanner_extracted_count: externalTotal,
    external_scanner_counts: normalizedExternal,
    counts_directly_comparable: false,
    counting_semantics: DEPENDENCY_COUNTING_SEMANTICS,
  };
}

export function classifyPriorFinding({ priorFinding, currentFinding = null, verification = null } = {}) {
  if (!priorFinding) throw new Error('priorFinding is required');

  if (currentFinding) {
    return {
      status: FIX_PROVE_STATUSES.NOT_RESOLVED,
      rationale: 'The fresh bounded re-assessment still observes the finding in the current snapshot.',
    };
  }

  if (verification?.kind === 'component-removed'
      && verification.currentSnapshotAbsenceConfirmed === true
      && verification.fresh === true) {
    return {
      status: FIX_PROVE_STATUSES.NO_LONGER_APPLICABLE,
      rationale: clean(
        verification.rationale
          || 'The affected component is no longer present in the active assessed scope, and the fresh re-assessment confirms the previous finding no longer applies to the current snapshot.',
        600,
      ),
    };
  }

  if (verification?.kind === 'retest-pass'
      && verification.fresh === true
      && verification.bounded === true
      && verification.supportsResolution === true) {
    return {
      status: FIX_PROVE_STATUSES.RESOLVED,
      rationale: clean(
        verification.rationale
          || 'Fresh bounded retest evidence supports resolution of the previously observed condition.',
        600,
      ),
    };
  }

  if (verification?.kind === 'partial'
      || verification?.supportsResolution === false
      || verification?.claimOnly === true) {
    return {
      status: FIX_PROVE_STATUSES.PARTIALLY_RESOLVED,
      rationale: clean(
        verification?.rationale
          || 'A remediation change is recorded, but the available fresh evidence does not fully verify closure of the prior finding.',
        600,
      ),
    };
  }

  return {
    status: FIX_PROVE_STATUSES.NOT_RESOLVED,
    rationale: 'The prior finding is not automatically closed by a remediation claim or by absence of proof. Fresh evidence supporting resolution is required.',
  };
}

function normalizeDeploymentDecision(input) {
  const requested = clean(input?.decision || input, 40).toUpperCase();
  if (!requested || requested === 'NOT RECORDED') {
    return { decision: 'NOT RECORDED', recordedBy: null, recordedAt: null, rationale: null };
  }
  const allowed = new Set(['PROCEED', 'HOLD', 'DO NOT DEPLOY']);
  if (!allowed.has(requested) || !input?.recordedBy || !input?.recordedAt) {
    return { decision: 'NOT RECORDED', recordedBy: null, recordedAt: null, rationale: null };
  }
  return {
    decision: requested === 'PROCEED' ? 'Proceed' : requested === 'HOLD' ? 'Hold' : 'Do not deploy',
    recordedBy: clean(input.recordedBy, 160),
    recordedAt: clean(input.recordedAt, 60),
    rationale: input.rationale ? clean(input.rationale, 800) : null,
  };
}

function postureEvidence(posture = {}) {
  const postureScore = finiteCount(posture.postureScore);
  const technicalRisk = finiteCount(posture.technicalRisk);
  const suppliedConclusion = clean(posture.conclusion, 700);
  if (FORBIDDEN_ASSURANCE.test(suppliedConclusion) || THIRD_PARTY_INDEPENDENCE.test(suppliedConclusion)) {
    throw new Error('Posture conclusion contains unsupported assurance or third-party-independence wording');
  }
  const scopeDisclaimer = postureScore === 100
    ? 'No material issue was observed in the inspected scope. Runtime and cloud controls may remain outside scope.'
    : clean(posture.scopeDisclaimer, 700) || null;
  return { postureScore, technicalRisk, conclusion: suppliedConclusion || null, scopeDisclaimer };
}

export function buildFixProveEvidencePacket(input = {}) {
  const priorFindings = Array.isArray(input.priorFindings) ? input.priorFindings : [];
  const currentFindings = Array.isArray(input.currentFindings) ? input.currentFindings : [];
  const verificationByFinding = input.verificationByFinding && typeof input.verificationByFinding === 'object'
    ? input.verificationByFinding
    : {};

  const currentByIdentity = new Map(currentFindings.map((finding) => [findingIdentity(finding), finding]));
  const comparisons = priorFindings.map((priorFinding) => {
    const identity = findingIdentity(priorFinding);
    const currentFinding = currentByIdentity.get(identity) || null;
    const lifecycle = classifyPriorFinding({
      priorFinding,
      currentFinding,
      verification: verificationByFinding[identity] || verificationByFinding[priorFinding.findingId] || null,
    });
    if (currentFinding) currentByIdentity.delete(identity);
    return {
      findingIdentity: identity,
      ruleId: clean(priorFinding.ruleId, 60) || null,
      title: clean(priorFinding.title, 180) || null,
      previousEvidence: priorFinding.evidence || null,
      currentEvidence: currentEvidenceSummary(currentFinding),
      lifecycleStatus: lifecycle.status,
      rationale: lifecycle.rationale,
    };
  });

  for (const [identity, finding] of currentByIdentity) {
    comparisons.push({
      findingIdentity: identity,
      ruleId: clean(finding.ruleId, 60) || null,
      title: clean(finding.title, 180) || null,
      previousEvidence: null,
      currentEvidence: currentEvidenceSummary(finding),
      lifecycleStatus: FIX_PROVE_STATUSES.NEW_FINDING,
      rationale: 'The current snapshot contains a finding that was not present in the prior assessed snapshot.',
    });
  }

  const remediationClaims = (Array.isArray(input.remediationClaims) ? input.remediationClaims : [])
    .map((item) => ({
      findingIdentity: clean(item?.findingIdentity || item?.findingId, 200) || null,
      change: clean(item?.change, 900),
      owner: clean(item?.owner, 160) || null,
      implementationEvidence: item?.implementationEvidence || null,
      status: 'claimed-remediation-pending-evidence-comparison',
    }))
    .filter((item) => item.change);

  const dependencyCounts = input.dependencyCounts
    ? dependencyCountPresentation(input.dependencyCounts)
    : null;

  return {
    schema: 'arl.fix-prove-evidence.v1',
    caseId: clean(input.caseId, 160) || null,
    target: clean(input.target, 240) || null,
    previousSnapshot: clean(input.previousSnapshot, 120) || null,
    currentSnapshot: clean(input.currentSnapshot, 120) || null,
    assessmentLabel: FRESH_RESCAN_LABEL,
    FIND: {
      priorFindings: priorFindings.map((finding) => ({
        findingIdentity: findingIdentity(finding),
        ruleId: clean(finding.ruleId, 60) || null,
        title: clean(finding.title, 180) || null,
        severity: clean(finding.severity, 30) || null,
        evidence: finding.evidence || null,
      })),
    },
    FIX: {
      status: remediationClaims.length ? 'claimed' : 'not-recorded',
      remediationClaims,
      trustBoundary: 'A claimed remediation is not treated as verified until fresh bounded evidence supports the lifecycle status.',
    },
    PROVE: {
      label: FRESH_RESCAN_LABEL,
      currentEvidence: input.currentEvidence || null,
      posture: postureEvidence(input.posture),
      dependencyCounts,
      findingComparison: comparisons,
    },
    REMAINING_GAPS: (Array.isArray(input.remainingGaps) ? input.remainingGaps : [])
      .map((gap) => clean(gap, 700))
      .filter(Boolean),
    DEPLOYMENT_DECISION: normalizeDeploymentDecision(input.deploymentDecision),
    trust: {
      evidenceBeforeClaims: true,
      certification: false,
      guaranteeRiskFree: false,
      statement: 'This evidence packet records bounded AgentRiskLayer evidence. It is not an accredited certification or a guarantee that the assessed system is risk-free.',
    },
  };
}

function display(value) {
  return value === null || value === undefined || value === '' ? 'Not recorded' : String(value);
}

export function renderFixProveMarkdown(packet) {
  if (!packet || packet.schema !== 'arl.fix-prove-evidence.v1') throw new Error('A valid Fix → Prove packet is required');
  const lines = [];
  lines.push('# AgentRiskLayer Fix → Prove Evidence');
  lines.push('');
  if (packet.caseId) lines.push(`**Case:** ${packet.caseId}`);
  if (packet.target) lines.push(`**Target:** ${packet.target}`);
  lines.push(`**Previous snapshot:** ${display(packet.previousSnapshot)}`);
  lines.push(`**Current snapshot:** ${display(packet.currentSnapshot)}`);
  lines.push(`**Re-assessment:** ${packet.assessmentLabel}`);
  lines.push('');

  lines.push('## FIND');
  lines.push('');
  if (!packet.FIND.priorFindings.length) lines.push('No prior findings were recorded.');
  for (const finding of packet.FIND.priorFindings) lines.push(`- ${finding.ruleId || 'Finding'} — ${finding.title || 'Untitled finding'}`);
  lines.push('');

  lines.push('## FIX');
  lines.push('');
  lines.push(packet.FIX.trustBoundary);
  for (const claim of packet.FIX.remediationClaims) lines.push(`- ${claim.change}${claim.owner ? ` — owner: ${claim.owner}` : ''}`);
  if (!packet.FIX.remediationClaims.length) lines.push('No remediation claim was recorded.');
  lines.push('');

  lines.push('## PROVE');
  lines.push('');
  const posture = packet.PROVE.posture;
  if (posture.postureScore !== null) lines.push(`**Posture score:** ${posture.postureScore}/100`);
  if (posture.technicalRisk !== null) lines.push(`**Technical risk:** ${posture.technicalRisk}/100`);
  if (posture.scopeDisclaimer) lines.push(`**Scope:** ${posture.scopeDisclaimer}`);
  if (posture.conclusion) lines.push(posture.conclusion);
  if (packet.PROVE.dependencyCounts) {
    const dep = packet.PROVE.dependencyCounts;
    lines.push('');
    lines.push(`**Inspector normalized dependency inventory:** ${display(dep.inventory_count)}`);
    lines.push(`**External scanner extracted packages:** ${display(dep.external_scanner_extracted_count)}`);
    lines.push(dep.counting_semantics);
  }
  lines.push('');
  lines.push('### Finding lifecycle');
  lines.push('');
  if (!packet.PROVE.findingComparison.length) lines.push('No finding lifecycle changes were recorded.');
  for (const item of packet.PROVE.findingComparison) {
    lines.push(`- **${item.lifecycleStatus}** — ${item.ruleId || 'Finding'} ${item.title || ''}`.trim());
    lines.push(`  - ${item.rationale}`);
  }
  lines.push('');

  lines.push('## REMAINING GAPS');
  lines.push('');
  if (!packet.REMAINING_GAPS.length) lines.push('No additional evidence gaps were recorded in this packet.');
  for (const gap of packet.REMAINING_GAPS) lines.push(`- ${gap}`);
  lines.push('');

  lines.push('## DEPLOYMENT DECISION');
  lines.push('');
  lines.push(`**${packet.DEPLOYMENT_DECISION.decision}**`);
  if (packet.DEPLOYMENT_DECISION.recordedBy) lines.push(`Recorded by: ${packet.DEPLOYMENT_DECISION.recordedBy}`);
  if (packet.DEPLOYMENT_DECISION.rationale) lines.push(packet.DEPLOYMENT_DECISION.rationale);
  lines.push('');
  lines.push(packet.trust.statement);
  lines.push('');

  const markdown = lines.join('\n');
  if (THIRD_PARTY_INDEPENDENCE.test(markdown)) throw new Error('Generated report implies unsupported third-party independence');
  // Negative trust disclaimers such as "not ... risk-free" are intentionally allowed.
  // Unsupported affirmative assurance is rejected at the supplied posture-conclusion boundary above.
  return markdown;
}
