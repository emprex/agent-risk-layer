const BOUNDED_CHECKS = Object.freeze([
  {
    id: 'mcp-authority', match: /tool|mcp|authori[sz]|permission|allowlist/i,
    title: 'Verify tool / MCP authority enforcement',
    why: 'Source review can show that a policy exists, but only a bounded runtime check can show whether an unauthorised agent or context is actually denied at execution time.',
    invariant: 'A tool or MCP action outside the active agent authority must be denied before execution.',
    cases: ['Deny', 'Allow', 'Isolation', 'Plugin / tool scope', 'Fail closed'], environment: 'non-production', caseId: 'RT-AUTH-001',
  },
  {
    id: 'approval-binding', match: /approval|human oversight|high-impact action/i,
    title: 'Verify exact-action approval binding',
    why: 'A declared approval flow is not proof that approval is bound to the exact action, target and parameters at execution time.',
    invariant: 'A consequential action must execute only with a valid approval bound to that exact action and parameters.',
    cases: ['No approval denied', 'Exact approval allowed', 'Changed parameters denied', 'Expired approval denied', 'Replay denied'], environment: 'non-production', caseId: 'RT-PI-008',
  },
  {
    id: 'memory-isolation', match: /memory|tenant|session|context isolation/i,
    title: 'Verify memory / tenant isolation',
    why: 'Static configuration can indicate intended separation, but bounded execution is needed to show that one user or tenant cannot read another context.',
    invariant: 'Data written under one authorised identity must not be retrievable by a different unauthorised identity.',
    cases: ['Owner read allowed', 'Cross-user read denied', 'Cross-tenant read denied', 'Namespace mismatch denied', 'Fail closed'], environment: 'non-production', caseId: 'RT-MEM-002',
  },
  {
    id: 'egress-boundary', match: /egress|outbound|network/i,
    title: 'Verify outbound network boundary',
    why: 'Configuration alone does not prove that blocked destinations cannot be reached by the running agent.',
    invariant: 'A destination outside the approved outbound policy must be blocked before data leaves the controlled environment.',
    cases: ['Allowed destination works', 'Blocked destination denied', 'Redirect does not bypass', 'Alternate protocol denied', 'Fail closed'], environment: 'non-production', caseId: 'RT-TOOL-004',
  },
  {
    id: 'containment-recovery', match: /kill switch|contain|recovery|incident response|revocation/i,
    title: 'Verify containment and recovery',
    why: 'A documented stop procedure is not proof that execution, credentials and tools can actually be contained when the agent is active.',
    invariant: 'Containment must stop the agent, revoke relevant authority and leave the system in the declared safe state.',
    cases: ['Stop execution', 'Revoke credential', 'Block tool access', 'Preserve evidence', 'Safe-state restart'], environment: 'non-production',
  },
  {
    id: 'audit-reconstruction', match: /logging|observability|audit|reconstruct/i,
    title: 'Verify audit reconstruction',
    why: 'Logging declarations need a bounded event to confirm that identity, action, approval and outcome can be reconstructed from retained evidence.',
    invariant: 'A bounded action must produce enough correlated evidence to reconstruct who acted, what was attempted, what authorised it and what happened.',
    cases: ['Identity recorded', 'Action recorded', 'Approval / policy recorded', 'Outcome recorded', 'Correlation retained'], environment: 'non-production',
  },
]);

function gapText(gap = {}) {
  return [gap.id, gap.name, gap.title, gap.domain, gap.category, gap.help, gap.evidence, gap.status].filter(Boolean).join(' ');
}

function materialGaps(assessment = {}) {
  const result = assessment.result || assessment;
  const exactSets = [result.blockingEvidenceGaps, result.unresolvedItems, result.blockingInformationGaps];
  for (const exact of exactSets) if (Array.isArray(exact) && exact.length) return exact;
  const controls = assessment.controls || result.controls || [];
  return controls.filter((control) => ['unresolved', 'evidence-required', 'not-applicable-declared'].includes(control.status));
}

function resolutions(assessment = {}) {
  const result = assessment.result || assessment;
  const value = result.evidencePlanResolutions || assessment.evidencePlanResolutions || {};
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function boundedCheckForGap(gap) {
  const text = gapText(gap);
  const check = BOUNDED_CHECKS.find((candidate) => candidate.match.test(text));
  return check ? { ...check, gap } : null;
}

export function buildEvidencePlan({ assessment = {}, inspections = [] } = {}) {
  const gaps = materialGaps(assessment);
  const resolved = resolutions(assessment);
  const latestInspection = Array.isArray(inspections) && inspections.length ? inspections[0] : null;
  if (!latestInspection) return { state: 'source-required', title: 'Run source evidence first', explanation: 'AgentRiskLayer needs observed source evidence before it selects runtime checks. A declaration is not proof, and runtime tests should be limited to questions source review cannot resolve.', checks: [], manual: gaps, resolved: [] };

  const checks = [];
  const manual = [];
  const resolvedItems = [];
  const seen = new Set();
  for (const gap of gaps) {
    const planned = boundedCheckForGap(gap);
    if (!planned) { manual.push(gap); continue; }
    const resolution = resolved[planned.id];
    if (resolution?.state === 'not-applicable') {
      resolvedItems.push({ ...planned, resolution });
      continue;
    }
    if (seen.has(planned.id)) continue;
    seen.add(planned.id);
    checks.push(planned);
  }

  if (checks.length) return { state: 'bounded-check-required', title: checks[0].title, explanation: 'Source evidence is present. Unresolved assessment questions remain open unless the evidence chain proves them. Run only the bounded runtime checks mapped to those material questions; keep all other unknowns as evidence gaps.', checks, manual, resolved: resolvedItems };
  return {
    state: manual.length ? 'manual-evidence-required' : 'no-runtime-check-selected',
    title: manual.length ? 'No bounded runtime check is justified automatically' : 'No material evidence gap requires a bounded runtime check',
    explanation: manual.length ? 'The remaining evidence questions are not mapped to a safe bounded runtime invariant. Keep them as evidence gaps until a reviewer defines an appropriate test; do not invent a finding or run a generic attack suite.' : 'Current assessment data does not identify a material evidence gap that needs runtime verification. This is not a deployment approval.',
    checks: [], manual, resolved: resolvedItems,
  };
}

export function evidencePlanCatalog() { return BOUNDED_CHECKS.map(({ match, ...item }) => ({ ...item })); }
