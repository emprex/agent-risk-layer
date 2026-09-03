function text(value = '') { return String(value ?? '').trim(); }
function when(value) { const parsed = Date.parse(value || ''); return Number.isFinite(parsed) ? parsed : 0; }

function targetDescriptor(run = {}) {
  const campaign = run.campaign || {};
  const target = campaign.target || {};
  return {
    mode: text(target.mode),
    environment: text(campaign.environment),
    endpointOrigin: text(target.endpointOrigin),
    endpointPathHash: text(target.endpointPathHash),
    profile: target.profile == null ? '' : text(target.profile),
  };
}

function sameTarget(left = {}, right = {}) {
  const a = targetDescriptor(left);
  const b = targetDescriptor(right);
  return a.mode === b.mode
    && a.environment === b.environment
    && a.endpointOrigin === b.endpointOrigin
    && a.endpointPathHash === b.endpointPathHash
    && a.profile === b.profile;
}

function runCompletedAt(run = {}) {
  return when(run.campaign?.completedAt || run.createdAt);
}

function caseResults(run = {}, caseId = '') {
  return Array.isArray(run.results)
    ? run.results.filter((result) => text(result.caseId) === caseId)
    : [];
}

function adapterRun(run = {}) {
  return run?.signatureValid === true
    && run?.trust?.evidenceClass === 'customer-operated-controlled-adversarial-test'
    && run?.campaign?.target?.mode === 'staging-adapter'
    && ['local', 'test', 'staging'].includes(text(run?.campaign?.environment))
    && Boolean(run?.authorisationId);
}

function latestCaseResult(run, caseId) {
  const results = caseResults(run, caseId);
  if (!results.length) return null;
  const outcomes = new Set(results.map((result) => text(result.outcome)));
  const outcome = outcomes.has('failed') ? 'failed'
    : outcomes.has('error') ? 'error'
      : outcomes.has('inconclusive') ? 'inconclusive'
        : outcomes.size === 1 && outcomes.has('passed') ? 'passed'
          : 'inconclusive';
  return { outcome, results };
}

function exactRetestPair(runs, caseId) {
  const ordered = [...runs].sort((a, b) => runCompletedAt(a) - runCompletedAt(b));
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const retest = ordered[index];
    const retestCase = latestCaseResult(retest, caseId);
    if (!retestCase || retestCase.outcome !== 'passed') continue;
    const retestFingerprints = new Set(retestCase.results.map((item) => text(item.requestFingerprint)).filter(Boolean));
    if (retestFingerprints.size !== 1) continue;
    const requestFingerprint = [...retestFingerprints][0];
    for (let baselineIndex = index - 1; baselineIndex >= 0; baselineIndex -= 1) {
      const baseline = ordered[baselineIndex];
      const baselineCase = latestCaseResult(baseline, caseId);
      if (!baselineCase || baselineCase.outcome !== 'failed') continue;
      const baselineFingerprints = new Set(baselineCase.results.map((item) => text(item.requestFingerprint)).filter(Boolean));
      if (baselineFingerprints.size !== 1 || !baselineFingerprints.has(requestFingerprint)) continue;
      if (!baseline.authorisationId || baseline.authorisationId !== retest.authorisationId) continue;
      if (!sameTarget(baseline, retest)) continue;
      if (text(baseline.policyVersion) !== text(retest.policyVersion)) continue;
      if (runCompletedAt(retest) <= runCompletedAt(baseline)) continue;
      return { baseline, retest, requestFingerprint };
    }
  }
  return null;
}

export function classifyBoundedCheckEvidence(check = {}, runs = []) {
  const caseId = text(check.caseId);
  if (!caseId) {
    return {
      state: 'test-not-defined',
      label: 'Bounded test not yet defined',
      finding: false,
      verified: false,
      caseId: '',
      runs: [],
      explanation: 'No approved automated case is mapped to this invariant. Keep the evidence question open until a bounded test is defined.',
    };
  }

  const relevantRuns = (Array.isArray(runs) ? runs : [])
    .filter(adapterRun)
    .filter((run) => caseResults(run, caseId).length)
    .sort((a, b) => runCompletedAt(b) - runCompletedAt(a));

  if (!relevantRuns.length) {
    return {
      state: 'open',
      label: 'Evidence still needed',
      finding: false,
      verified: false,
      caseId,
      runs: [],
      explanation: 'No integrity-verified authorised adapter result is recorded for this planned case.',
    };
  }

  const latest = relevantRuns[0];
  const latestCase = latestCaseResult(latest, caseId);
  if (!latestCase) {
    return {
      state: 'open', label: 'Evidence still needed', finding: false, verified: false, caseId, runs: relevantRuns,
      explanation: 'The latest run does not contain a usable result for this planned case.',
    };
  }

  if (latestCase.outcome === 'failed') {
    return {
      state: 'confirmed-failure',
      label: 'Confirmed test failure',
      finding: true,
      verified: false,
      caseId,
      latestRun: latest,
      latestResult: latestCase,
      runs: relevantRuns,
      explanation: 'The authorised bounded case reproduced a failure. This is evidence-backed and is eligible for remediation; it is not merely an assessment concern.',
    };
  }

  if (latestCase.outcome === 'inconclusive' || latestCase.outcome === 'error') {
    return {
      state: 'inconclusive',
      label: 'Inconclusive evidence',
      finding: false,
      verified: false,
      caseId,
      latestRun: latest,
      latestResult: latestCase,
      runs: relevantRuns,
      explanation: 'The bounded case did not produce a reliable pass/fail result. Keep the question open and rerun only after the test condition is corrected.',
    };
  }

  const pair = exactRetestPair(relevantRuns, caseId);
  if (pair) {
    return {
      state: 'exact-retest-supported',
      label: 'Exact bounded retest passed',
      finding: false,
      verified: false,
      caseId,
      latestRun: pair.retest,
      baselineRun: pair.baseline,
      requestFingerprint: pair.requestFingerprint,
      runs: relevantRuns,
      explanation: 'The same case was first reproduced as failed and later passed under the same Rules of Engagement, target, policy version and request fingerprint. This supports the remediation for this probe, but does not automatically prove every case in the wider invariant.',
    };
  }

  return {
    state: 'supporting-pass',
    label: 'Supporting pass evidence',
    finding: false,
    verified: false,
    caseId,
    latestRun: latest,
    latestResult: latestCase,
    runs: relevantRuns,
    explanation: 'The mapped starting probe passed, but there is no reproduced failed baseline and exact retest lineage for this question. Treat it as supporting evidence, not verified remediation.',
  };
}

export function classifyEvidencePlan(plan = {}, runs = []) {
  const checks = (plan.checks || []).map((check) => ({ check, evidence: classifyBoundedCheckEvidence(check, runs) }));
  const confirmedFailures = checks.filter((item) => item.evidence.state === 'confirmed-failure');
  const inconclusive = checks.filter((item) => item.evidence.state === 'inconclusive');
  const open = checks.filter((item) => ['open', 'test-not-defined', 'supporting-pass', 'exact-retest-supported'].includes(item.evidence.state));
  return {
    checks,
    confirmedFailures,
    inconclusive,
    open,
    readyForHumanReview: confirmedFailures.length === 0 && inconclusive.length === 0,
    completeForProceed: false,
    limitation: 'Mapped Red Team cases are bounded supporting probes. AgentRiskLayer does not infer full invariant verification or a deployment approval from them alone.',
  };
}
