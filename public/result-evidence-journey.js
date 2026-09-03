import { api, escapeHtml, qs } from './shared.js';
import { buildEvidencePlan } from './evidence-plan.js';
import { classifyEvidencePlan } from './evidence-plan-outcomes.js';

const assessmentId = qs('id');
let rendered = false;

async function fullRuns(assessmentId) {
  const { runs = [] } = await api(`/api/assessments/${encodeURIComponent(assessmentId)}/redteam`);
  const hydrated = await Promise.all(runs.map(async (summary) => {
    if (!summary?.id) return null;
    try { return (await api(`/api/redteam/runs/${encodeURIComponent(summary.id)}`)).run || null; }
    catch { return null; }
  }));
  return hydrated.filter(Boolean);
}

function nextAction({ assessment, inspections, plan, outcome }) {
  if (!inspections.length) {
    return {
      stage: 'PROVE',
      title: 'Run source evidence',
      body: 'Freeze the source evidence for this assessment before choosing runtime checks.',
      href: `/inspector.html?assessment=${encodeURIComponent(assessment.id)}`,
      action: 'Run source evidence',
    };
  }
  const failure = outcome.confirmedFailures[0];
  if (failure) {
    const query = new URLSearchParams({ assessment: assessment.id, source: 'redteam', case: failure.check.caseId, plan: failure.check.id, baseline: failure.evidence.latestRun.id });
    if (failure.evidence.latestRun.authorisationId) query.set('roe', failure.evidence.latestRun.authorisationId);
    return {
      stage: 'FIX',
      title: 'Fix the confirmed bounded-test failure',
      body: `${failure.check.caseId} reproduced a failure. Assign an owner, preserve implementation evidence, then retest the exact case.`,
      href: `/control-plane.html?${query.toString()}#remediation`,
      action: 'Fix confirmed failure',
    };
  }
  const uncertain = outcome.inconclusive[0];
  if (uncertain) {
    const query = new URLSearchParams({ assessment: assessment.id, case: uncertain.check.caseId, plan: uncertain.check.id });
    return {
      stage: 'PROVE',
      title: 'Rerun the inconclusive bounded check',
      body: 'The last run did not establish pass or failure. Correct the test condition without turning it into a finding.',
      href: `/redteam.html?${query.toString()}`,
      action: 'Rerun bounded check',
    };
  }
  const openCheck = outcome.checks.find((item) => ['open','supporting-pass','exact-retest-supported'].includes(item.evidence.state));
  if (openCheck) {
    const query = new URLSearchParams({ assessment: assessment.id, case: openCheck.check.caseId, plan: openCheck.check.id });
    const baseline = openCheck.evidence.baselineRun || openCheck.evidence.latestRun;
    if (baseline?.id && openCheck.evidence.state !== 'open') {
      query.set('retest', '1'); query.set('baseline', baseline.id);
      if (baseline.authorisationId) query.set('roe', baseline.authorisationId);
    }
    const supported = openCheck.evidence.state === 'exact-retest-supported';
    return {
      stage: 'PROVE',
      title: supported ? 'Review the remaining evidence gap' : 'Continue the bounded evidence check',
      body: supported
        ? 'The exact starting probe has supporting retest lineage, but that does not verify every case in the wider invariant.'
        : 'A material evidence question remains open. Run only the selected bounded check rather than a generic attack suite.',
      href: `/redteam.html?${query.toString()}`,
      action: supported ? 'Review exact check' : 'Continue evidence',
    };
  }
  if (plan.manual?.length) {
    return {
      stage: 'PROVE',
      title: 'Review the remaining evidence gap',
      body: 'No safe automatic bounded test is mapped to the remaining material question. Keep it open until appropriate evidence is defined.',
      href: `/inspector.html?assessment=${encodeURIComponent(assessment.id)}`,
      action: 'Review evidence plan',
    };
  }
  return {
    stage: 'DEPLOY',
    title: 'Open deployment review',
    body: 'No mapped bounded-test failure is open. An accountable human must still review the full evidence chain and record the deployment decision.',
    href: `/control-plane.html?assessment=${encodeURIComponent(assessment.id)}`,
    action: 'Open deployment review',
  };
}

function journeyHtml(action) {
  return `<section class="workspace-section result-evidence-journey" data-result-evidence-journey>
    <span class="eyebrow">Customer journey</span>
    <h2>Assess → Evidence → Fix → Retest → Decision</h2>
    <div class="workspace-next-action"><small>Current step · ${escapeHtml(action.stage)}</small><strong>${escapeHtml(action.title)}</strong><p>${escapeHtml(action.body)}</p><a class="button primary small" href="${escapeHtml(action.href)}">${escapeHtml(action.action)}</a></div>
    <p class="microcopy">AgentRiskLayer provides evidence and keeps uncertainty visible. It does not automatically record Proceed from a passing scan or test.</p>
  </section>`;
}

function insert(html) {
  if (rendered || document.querySelector('[data-result-evidence-journey]')) return true;
  const target = document.querySelector('.result-target-card') || document.querySelector('.result-side-panel');
  if (!target) return false;
  if (target.classList.contains('result-target-card')) target.insertAdjacentHTML('afterend', html);
  else target.insertAdjacentHTML('afterbegin', html);
  rendered = true;
  return true;
}

async function load() {
  if (!assessmentId || rendered) return;
  try {
    const [assessmentPayload, inspectionPayload, runs] = await Promise.all([
      api(`/api/assessments/${encodeURIComponent(assessmentId)}`),
      api(`/api/assessments/${encodeURIComponent(assessmentId)}/inspections`),
      fullRuns(assessmentId),
    ]);
    const assessment = assessmentPayload.assessment || {};
    const inspections = [...(inspectionPayload.inspections || [])].sort((a,b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
    const plan = buildEvidencePlan({ assessment, inspections });
    const outcome = classifyEvidencePlan(plan, runs);
    const action = nextAction({ assessment, inspections, plan, outcome });
    const html = journeyHtml(action);
    if (!insert(html)) {
      const observer = new MutationObserver(() => { if (insert(html)) observer.disconnect(); });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }
  } catch {
    // Shared/public assessment views may not have owner-only Evidence APIs. Do not weaken their existing result view.
  }
}

void load();
